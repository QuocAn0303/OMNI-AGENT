import api from './axios';
const base='/vn-supply-chain';
export const getVnDemo=()=>api.get(base+'/demo').then(r=>r.data.data);
export const advanceVnDemo=input=>api.post(base+'/demo/step',input).then(r=>r.data.data);
export const resetVnDemo=()=>api.post(base+'/demo/reset',{}).then(r=>r.data.data);
export const runVnScenario=scenario=>api.post(base+'/scenarios',{scenario}).then(r=>r.data.data);
export async function downloadVnReport(format,reportId) {
  const response=await api.get(base+'/export',{params:{format,reportId},responseType:'blob'});
  const url=URL.createObjectURL(response.data),anchor=document.createElement('a');
  anchor.href=url;anchor.download='vn-supply-chain.'+format;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
