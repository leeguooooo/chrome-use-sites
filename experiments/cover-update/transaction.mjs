// Offline transaction core. No live browser driver is shipped with this module.
import {createHash} from 'node:crypto'
const digest=value=>createHash('sha256').update((JSON.stringify(value) ?? 'undefined')).digest('hex')
const clone=value=>JSON.parse(JSON.stringify(value))
const equal=(a,b)=>digest(a)===digest(b)
const validFingerprint=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const RATIOS={'wechat-channels':['3:4'],'douyin-creator':['3:4','4:3'],'bilibili-creator':['4:3','16:9']}
function validate(snapshot,files) {
 if(!snapshot||!RATIOS[snapshot.platform]||typeof snapshot.id!=='string'||!snapshot.id.trim())throw Error('A supported platform and exact string work id are required')
 if(typeof snapshot.revision!=='string'||!snapshot.revision||!validFingerprint(snapshot.coverFingerprint))throw Error('A revision and current persisted cover fingerprint are required')
 if(!Array.isArray(files)||!files.length||files.some(f=>!validFingerprint(f.sha256)||!/^image\/(jpeg|png)$/.test(f.type)))throw Error('Cover files require SHA-256 fingerprints and JPG/PNG content types')
 const ratios=files.flatMap(f=>f.ratios||[])
 if(!equal([...ratios].sort(),[...RATIOS[snapshot.platform]].sort()))throw Error('Each required ratio must be assigned exactly once')
}
const limitations=platform=>[
 'Changing an existing work may trigger another platform review; verify the editor restriction notice before applying.',
 ...(platform==='wechat-channels'?['WeChat Channels may allow only one modification and show an edited-information label. A confirmed remaining-edit count is required.']:[]),
 'This transaction core has only offline fixture coverage. Live editor drivers are not included.'
]
const blockers=s=>[
 ...(s.restrictions?.confirmed!==true?['platform_restrictions_unknown']:[]),
 ...(s.restrictions?.canEdit!==true?['editing_not_allowed']:[]),
 ...(s.platform==='wechat-channels'&&(!Number.isInteger(s.restrictions?.remainingEdits)||s.restrictions.remainingEdits<1)?['remaining_edits_unavailable']:[]),
 ...(s.restrictions?.remainingEdits===0?['edit_limit_reached']:[])
]
export function createPlan(snapshot,files) {
 validate(snapshot,files)
 const payload=clone({snapshot,files})
 const plan={schema:1,...payload,ratios:[...RATIOS[snapshot.platform]],limitations:limitations(snapshot.platform),blockers:blockers(snapshot)}
 return Object.freeze({...plan,planId:digest(plan),status:'confirmation_required',changed:false})
}
function verifyPlan(plan) {
 if(!plan||plan.schema!==1)throw Error('Unsupported plan')
 const {planId,status,changed,...signed}=plan
 if(planId!==digest(signed)||status!=='confirmation_required'||changed!==false)throw Error('Plan contents changed; create and review a new plan')
 validate(plan.snapshot,plan.files)
 if(!equal(signed.ratios,RATIOS[plan.snapshot.platform])||!equal(signed.blockers,blockers(plan.snapshot))||!equal(signed.limitations,limitations(plan.snapshot.platform)))throw Error('Plan policy changed; create and review a new plan')
}
function sameTargetAndBase(actual,expected) {
 return actual?.platform===expected.platform&&actual?.id===expected.id&&actual?.revision===expected.revision&&actual?.coverFingerprint===expected.coverFingerprint&&equal(actual?.restrictions,expected.restrictions)
}
function preparedFor(p,plan) {
 return p?.platform===plan.snapshot.platform&&p?.id===plan.snapshot.id&&validFingerprint(p.coverFingerprint)&&equal([...(p.ratios||[])].sort(),[...plan.ratios].sort())&&equal(p.fileFingerprints,plan.files.map(f=>f.sha256))
}
// The caller supplies a future platform driver, and must keep the returned
// receipt even when a network/process failure makes the result uncertain.
// prepare affects only the local edit form; commit is the single remote write.
export async function applyPlan(plan,{confirmation,files,driver,journal}={}) {
 verifyPlan(plan)
 if(confirmation!==plan.planId)return {status:'confirmation_required',changed:false,planId:plan.planId,limitations:plan.limitations}
 if(plan.blockers.length)return {status:'blocked',changed:false,blockers:plan.blockers}
 if(!equal(files,plan.files))return {status:'file_mismatch',changed:false}
 for(const method of ['inspect','prepare','commit'])if(typeof driver?.[method]!=='function')throw Error('Missing platform driver method: '+method)
 for(const method of ['claim','record'])if(typeof journal?.[method]!=='function')throw Error('A durable transaction journal is required: '+method)
 let baseline
 try{baseline=await driver.inspect(plan.snapshot.id)}catch{return {status:'inspection_unavailable',changed:false}}
 if(!sameTargetAndBase(baseline,plan.snapshot))return {status:'stale_plan',changed:false,hint:'Review the latest work and restrictions before creating another plan.'}
 let reserved
 try{reserved=await journal.claim({platform:plan.snapshot.platform,id:plan.snapshot.id,planId:plan.planId})}catch{return {status:'journal_unavailable',changed:false}}
 if(reserved!==true)return {status:'reconciliation_required',changed:'unknown',retryable:false,planId:plan.planId}
 let prepared
 try{prepared=await driver.prepare(clone(plan.files),clone(plan.snapshot))}catch{return {status:'preparation_unknown',changed:'unknown',retryable:false,hint:'Inspect the local editor; do not upload again automatically.'}}
 if(!preparedFor(prepared,plan))return {status:'preparation_unverified',changed:'local_form_possible',retryable:false}
 // Recheck identity, persisted state and restrictions after potentially slow
 // uploading/cropping. Never let an old review authorize a new document/work.
 let fresh
 try{fresh=await driver.inspect(plan.snapshot.id)}catch{return {status:'inspection_unavailable',changed:'local_form_possible',retryable:false}}
 if(!sameTargetAndBase(fresh,plan.snapshot))return {status:'stale_plan',changed:'local_form_possible',retryable:false}
 if(prepared.coverFingerprint===fresh.coverFingerprint)return {status:'unchanged',changed:false,verified:true}
 const receipt={planId:plan.planId,platform:plan.snapshot.platform,id:plan.snapshot.id,expectedCoverFingerprint:prepared.coverFingerprint}
 try{await journal.record(clone(receipt))}catch{return {status:'journal_unavailable',changed:'local_form_possible',retryable:false}}
 let commitError=false
 try{await driver.commit(clone(receipt))}catch{commitError=true}
 let after
 try{after=await driver.inspect(plan.snapshot.id)}catch{return {status:'action_outcome_unknown',changed:'unknown',retryable:false,receipt}}
 if(after?.platform===receipt.platform&&after?.id===receipt.id&&after?.coverFingerprint===receipt.expectedCoverFingerprint) return {status:'updated',changed:true,verified:true,commitResponse:commitError?'unconfirmed':'received',receipt}
 // A rejected/timed-out call is never permission to replay a potentially
 // one-time write. A live driver must offer read-only reconciliation later.
 return {status:'action_outcome_unknown',changed:'unknown',retryable:false,receipt}
}
export function reconcile(receipt,snapshot) {
 if(!receipt||!validFingerprint(receipt.expectedCoverFingerprint))throw Error('A valid transaction receipt is required')
 if(snapshot?.platform===receipt.platform&&snapshot?.id===receipt.id&&snapshot?.coverFingerprint===receipt.expectedCoverFingerprint)return {status:'updated',changed:true,verified:true,receipt}
 return {status:'action_outcome_unknown',changed:'unknown',retryable:false,receipt}
}
