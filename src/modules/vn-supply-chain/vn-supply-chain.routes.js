'use strict';
const { Router } = require('express');
const { z } = require('zod');
const { createDemoSession } = require('./services/demo-session.service');
const { exportSpreadsheetData } = require('./services/spreadsheet-export.service');
function createVnSupplyChainRouter(dependencies = {}) {
  const { authenticate, authorize } = dependencies.auth || require('../../middleware/auth.middleware');
  const { success } = dependencies.response || require('../../utils/response');
  const router=Router(), sessions=new Map();
  router.use(authenticate,authorize('ADMIN','MANAGER','WAREHOUSE','ACCOUNTANT'));
  function session(req) {
    if(!req.user?.id)throw Object.assign(new Error('Thiếu người dùng'),{status:401});
    const key=JSON.stringify([req.user.tenantId||'personal',req.user.id]), time=Date.now();
    for(const [id,row] of sessions)if(time-row.lastAccess>1800000)sessions.delete(id);
    if(!sessions.has(key)){
      if(sessions.size>=20)throw Object.assign(new Error('Demo đang đủ phiên; thử lại sau'),{status:503});
      sessions.set(key,{value:createDemoSession(),lastAccess:time});
    }
    sessions.get(key).lastAccess=time;
    return {key,value:sessions.get(key).value};
  }
  const handler=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
  /**
   * @swagger
   * /api/vn-supply-chain/demo:
   *   get:
   *     summary: Phiên demo riêng theo tenant và người dùng, kèm báo cáo thống nhất
   *     tags: [VN Supply Chain]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Tồn kho, bước demo, KPI, PnL và dòng tiền }
   */
  router.get('/demo',handler((req,res)=>success(res,session(req).value.snapshot())));
  /**
   * @swagger
   * /api/vn-supply-chain/demo/step:
   *   post:
   *     summary: Chạy bước demo kế tiếp; bước 1 hỗ trợ receive và putaway
   *     tags: [VN Supply Chain]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [step]
   *             properties:
   *               step: { type: integer, minimum: 1, maximum: 5 }
   *               phase: { type: string, enum: [receive, putaway] }
   *     responses:
   *       200: { description: Phiên demo và báo cáo mới }
   *       409: { description: Bước không liên tục }
   */
  router.post('/demo/step',handler((req,res)=>success(res,session(req).value.advance(req.body))));
  /**
   * @swagger
   * /api/vn-supply-chain/demo/reset:
   *   post:
   *     summary: Khởi tạo lại phiên demo của người dùng hiện tại
   *     tags: [VN Supply Chain]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Phiên mới }
   */
  router.post('/demo/reset',handler((req,res)=>{
    z.object({}).strict().parse(req.body||{});
    const {key}=session(req);sessions.set(key,{value:createDemoSession(),lastAccess:Date.now()});
    success(res,sessions.get(key).value.snapshot());
  }));
  /**
   * @swagger
   * /api/vn-supply-chain/metrics:
   *   get:
   *     summary: Báo cáo KPI và tài chính 60 ngày của phiên hiện tại
   *     tags: [VN Supply Chain]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Báo cáo cùng reportId với demo và export }
   */
  router.get('/metrics',handler((req,res)=>success(res,session(req).value.snapshot().report)));
  /**
   * @swagger
   * /api/vn-supply-chain/scenarios:
   *   post:
   *     summary: Kết quả hai tình huống từ cùng snapshot báo cáo
   *     tags: [VN Supply Chain]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: So sánh trước và sau }
   */
  router.post('/scenarios',handler((req,res)=>{
    const {scenario}=z.object({scenario:z.enum(['delay','surge'])}).strict().parse(req.body);
    const report=session(req).value.snapshot().report;
    success(res,{reportId:report.reportId,...report.scenarios[scenario]});
  }));
  /**
   * @swagger
   * /api/vn-supply-chain/export:
   *   get:
   *     summary: Xuất toàn bộ nguồn và báo cáo JSON, CSV hoặc XLSX
   *     tags: [VN Supply Chain]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: query, name: format, schema: { type: string, enum: [json, csv, xlsx], default: xlsx } }
   *       - { in: query, name: reportId, schema: { type: string } }
   *     responses:
   *       200: { description: Tệp xuất kèm X-Report-Id }
   *       409: { description: Báo cáo đã thay đổi, tải lại trước khi xuất }
   */
  router.get('/export',handler(async(req,res)=>{
    const query=z.object({format:z.enum(['json','csv','xlsx']).default('xlsx'),reportId:z.string().max(64).optional()}).strict().parse(req.query);
    const report=session(req).value.snapshot().report;
    if(query.reportId && query.reportId!==report.reportId)throw Object.assign(new Error('Báo cáo đã thay đổi, hãy tải lại'),{status:409});
    const file=await exportSpreadsheetData(report,query.format);
    res.set({'Content-Type':file.contentType,'Content-Disposition':'attachment; filename="'+file.filename+'"','X-Report-Id':report.reportId});
    res.send(file.data);
  }));
  router.use(require('./routes/vn-supply-chain.routes')(dependencies));
  return router;
}
module.exports=createVnSupplyChainRouter;
