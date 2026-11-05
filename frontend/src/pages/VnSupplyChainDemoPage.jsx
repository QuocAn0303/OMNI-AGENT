import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Col, Collapse, Descriptions, Modal, Row, Select, Space, Spin, Statistic, Steps, Table, Tabs, Tag, Typography } from 'antd';
import { PlayCircleOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { getVnDemo, advanceVnDemo, resetVnDemo, runVnScenario, downloadVnReport } from '../api/vnSupplyChain';
const { Title, Text }=Typography;
const format=value=>value==null?'Chưa đủ dữ liệu':Number(value).toLocaleString('vi-VN',{maximumFractionDigits:2});
const labels={
  grossRevenue:'Doanh thu gộp',returnsValue:'Giảm trừ hoàn/RTS',netRevenue:'Doanh thu thuần',cogs:'Giá vốn FIFO',grossProfit:'Lợi nhuận gộp',
  outboundFreight:'Cước chiều đi',returnFreight:'Cước chiều về',holdingCost:'Lưu kho',packingCost:'Nhặt / đóng gói',repackCost:'Tân trang',
  writeOffCost:'Hao hụt',operatingProfit:'Lợi nhuận hoạt động',cashOpening:'Tiền đầu kỳ',prepaidReceipts:'Thu trả trước',codReceipts:'Thu COD',
  refundsPaid:'Hoàn tiền',supplierDeposit:'Cọc NCC 30%',supplierBalance:'Trả NCC 70%',cashExpenses:'Chi vận hành',cashClosing:'Tiền cuối kỳ',
  otifPercent:'OTIF (%)',orderFillRatePercent:'Order Fill Rate (%)',orderCycleTimeDays:'Chu kỳ đơn (ngày)',returnRtsRatePercent:'Hoàn / RTS (%)',
  resolvedUnits:'Đã có kết quả giao',pendingUnits:'Đang giao',averageInventoryValue:'Tồn kho bình quân (VNĐ)',inventoryTurnover:'Vòng quay tồn kho',
  daysOfInventory:'Số ngày tồn kho',logisticsCostToRevenuePercent:'Logistics / doanh thu (%)',grossMarginPercent:'Biên lợi nhuận gộp (%)',
  operatingAssetReturnPercent:'EBIT / tồn + COD phải thu (%)',roaPercent:'ROA đầy đủ (%)',responseDays:'Thời gian nguồn ứng cứu về (ngày)',
  additionalUnits14Days:'Cấp thêm so với cầu nền (14 ngày)',recoveredUnits14Days:'Khôi phục so với chưa ứng phó',peakDispatchSlaPercent:'SLA bàn giao giai đoạn đỉnh (%)',feasible:'Phương án khả thi',
  seasonalRevenue:'Doanh thu mùa vụ (VNĐ)',seasonalRevenueSharePercent:'Tỷ trọng mùa vụ (%)',timeToMarketDays:'Time-to-Market (ngày)',poToShelfDays:'PO → lên kệ (ngày)'
};
const steps=['Nhập & kiểm định','Nhận đơn đa kênh','Nhặt · đóng · xuất','Hoàn trả & QC','KPI & tài chính'];
export default function VnSupplyChainDemoPage() {
  const {t}=useTranslation();
  const tr=(key,fallback)=>t('vnSupplyChainDemo.'+key,{defaultValue:fallback});
  const [session,setSession]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[scenario,setScenario]=useState(null),[exportFormat,setExportFormat]=useState('xlsx');
  useEffect(()=>{let active=true;getVnDemo().then(r=>{if(active)setSession(r);}).catch(e=>{if(active)setError(e.response?.data?.message||e.message);});return()=>{active=false;};},[]);
  const perform=async task=>{setBusy(true);setError('');try{await task();}catch(e){setError(e.response?.data?.message||e.message||'Không thể hoàn tất thao tác');}finally{setBusy(false);}};
  const advance=()=>perform(async()=>setSession(await advanceVnDemo({step:session.stage+1,...(session.stage===0?{phase:session.received?'putaway':'receive'}:{})})));
  if(!session)return <Space orientation="vertical"><Spin/><Alert type="info" title={error||tr('loading','Đang dựng báo cáo 60 ngày…')}/>{error&&<Button onClick={()=>perform(async()=>setSession(await getVnDemo()))}>{tr('retry','Thử lại')}</Button>}</Space>;
  const report=session.report;
  const moneyColumns=fields=>[{title:'Kỳ báo cáo',dataIndex:'label',fixed:'left',width:150},...fields.map(key=>({title:labels[key],dataIndex:key,key,width:170,align:'right',render:v=><Text type={v<0?'danger':undefined}>{format(v)}</Text>}))];
  const stockColumns=[{title:'Ô kệ',dataIndex:'binId',width:210},...['onHandQty','reservedQty','quarantineQty','inTransitQty','atpQty'].map(key=>({title:{onHandQty:'Trên kệ',reservedQty:'Giữ chỗ',quarantineQty:'Chờ QC',inTransitQty:'Đang về',atpQty:'ATP'}[key],dataIndex:key,align:'right',render:format}))];
  const scenarioRows=scenario?.comparison.map(c=>({...c,key:c.metric,metric:{stockoutUnits:'Thiếu hàng (đơn vị)',stockoutRate:'Tỷ lệ thiếu hàng',unfulfilled:'Cầu chưa đáp ứng',dispatchSlaRate:'Tỷ lệ bàn giao đúng ngày'}[c.metric]}))||[];
  return <Space orientation="vertical" size={20} style={{width:'100%',paddingBottom:32}}>
    <Row gutter={[16,16]} align="middle" justify="space-between">
      <Col><Tag color="cyan">{tr('tag','PHÒNG MÔ PHỎNG CHUỖI CUNG ỨNG')}</Tag><Title level={2} style={{margin:'10px 0 4px'}}>{tr('title','Từ ô kệ đến dòng tiền')}</Title>
        <Text type="secondary">{report.metadata.startDate} → {report.metadata.endDate} · 60 ngày · VNĐ · {report.reportId}</Text></Col>
      <Col><Space wrap>
        <Button icon={<ReloadOutlined/>} disabled={busy} onClick={()=>Modal.confirm({title:tr('resetTitle','Khởi tạo lại phiên demo này?'),content:tr('resetNote','Chỉ dữ liệu mô phỏng của bạn được đặt lại.'),onOk:()=>perform(async()=>setSession(await resetVnDemo()))})}>{tr('reset','Bắt đầu lại')}</Button>
        <Select aria-label="Định dạng xuất" value={exportFormat} onChange={setExportFormat} options={['xlsx','csv','json'].map(value=>({value,label:value.toUpperCase()}))}/>
        <Button icon={<DownloadOutlined/>} disabled={busy} onClick={()=>perform(()=>downloadVnReport(exportFormat,report.reportId))}>{tr('export','Xuất dữ liệu')}</Button>
      </Space></Col>
    </Row>
    {error&&<Alert closable type="error" title={error} onClose={()=>setError('')}/>}
    <Alert type="info" showIcon title={tr('simulation','Dữ liệu mô phỏng, không ghi vào giao dịch kinh doanh thật')}
      description={tr('periods','Báo cáo gồm 8 tuần và 4 ngày cuối kỳ. Doanh thu chỉ ghi khi hoàn tất giao; khoản COD chưa đối soát được theo dõi riêng.')}/>
    <Card>
      <Steps current={session.stage} items={steps.map(title=>({title}))} size="small"/>
      <Row gutter={[20,20]} style={{marginTop:24}} align="middle">
        <Col flex="auto"><Title level={4} style={{margin:0}}>{session.stage===5?tr('complete','Đã hoàn tất toàn bộ quy trình'):steps[session.stage]}</Title>
          <Text type="secondary">{session.stage===0?(session.received?'200 đơn vị tại Q: 198 đạt QC, 2 lỗi. Tiếp tục lên kệ để mở ATP.':'PO 200 bình giữ nhiệt → GRN → kiểm định tại WH-HN.'):session.stage===1?'Tiếp nhận 3 đơn Shopee / TikTok Shop / Website, giữ chỗ 9 đơn vị.':session.stage===2?'Nhặt và đóng gói 3 kiện, bàn giao GHN/GHTK.':session.stage===3?'Hai kiện giao thành công; một kiện COD thất bại 3 lần, hoàn A/B/C mỗi loại 1 đơn vị.':'KPI, tài chính và file xuất dùng cùng một mã báo cáo.'}</Text></Col>
        <Col><Button type="primary" size="large" icon={<PlayCircleOutlined/>} loading={busy} disabled={session.stage===5} onClick={advance}>
          {session.stage===0&&session.received?tr('putaway','Lên kệ → mở ATP'):session.stage===5?tr('done','Hoàn tất'):tr('run','Chạy bước')+' '+(session.stage+1)}
        </Button></Col>
      </Row>
      <Table size="small" style={{marginTop:20}} rowKey={r=>r.binId+r.sku} dataSource={session.inventory} columns={stockColumns} pagination={false} scroll={{x:750}} locale={{emptyText:'Chưa có hàng trong phiên demo'}}/>
      <Collapse ghost items={[{key:'history',label:tr('history','Xem lịch sử chuyển trạng thái kho'),children:session.transitions.map((h,i)=><div key={i}><Text strong>{h.label}</Text><Table size="small" rowKey={r=>r.binId+r.sku} dataSource={h.inventory} columns={stockColumns} pagination={false} scroll={{x:750}}/></div>)}]}/>
    </Card>
    <Row gutter={[16,16]}>{[
      ['Doanh thu thuần',report.pnl.netRevenue,'VNĐ'],['Lợi nhuận hoạt động',report.pnl.operatingProfit,'VNĐ'],
      ['Tiền cuối 60 ngày',report.cashFlow.closingCash,'VNĐ'],['OTIF',report.kpis.customerService.otifPercent,'%']
    ].map(([title,value,suffix])=><Col xs={24} sm={12} xl={6} key={title}><Card><Statistic title={title} value={value} formatter={format} suffix={suffix} styles={{content:{color:value<0?'#cf1322':undefined,fontSize:24}}}/></Card></Col>)}</Row>
    <Card title={tr('kpi','4 nhóm chỉ tiêu hiệu quả')}>
      <Tabs items={Object.entries(report.kpis).map(([key,values],i)=>({key,label:['Dịch vụ khách hàng','Hiệu quả nội bộ','Linh hoạt nhu cầu','Phát triển sản phẩm'][i],
        children:<Row gutter={[16,16]}>{Object.entries(values).map(([metric,value])=><Col xs={24} sm={12} xl={8} key={metric}><Card size="small"><Statistic title={labels[metric]||metric} value={value??0} formatter={()=>typeof value==='boolean'?(value?'Có':'Không'):format(value)}/></Card></Col>)}</Row>}))}/>
    </Card>
    <Card title={tr('finance','Tài chính 60 ngày · VNĐ')}>
      <div style={{height:280,width:'100%'}}><ResponsiveContainer><ComposedChart data={report.periods} margin={{top:10,right:20,left:35,bottom:5}}>
        <CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="label"/><YAxis tickFormatter={n=>(n/1000000).toFixed(0)+'tr'}/><Tooltip formatter={v=>format(v)+' VNĐ'}/>
        <Bar dataKey="netRevenue" name="Doanh thu thuần" fill="#0d9488" radius={[4,4,0,0]}/><Line dataKey="cashClosing" name="Tiền cuối kỳ" stroke="#1d4ed8" strokeWidth={2}/>
      </ComposedChart></ResponsiveContainer></div>
      <Tabs items={[
        {key:'pnl',label:'Kết quả kinh doanh',children:<Table rowKey="period" size="small" dataSource={report.periods} columns={moneyColumns(['grossRevenue','returnsValue','netRevenue','cogs','grossProfit','outboundFreight','returnFreight','holdingCost','packingCost','repackCost','writeOffCost','operatingProfit'])} pagination={false} scroll={{x:2200}}/>},
        {key:'cash',label:'Dòng tiền',children:<Table rowKey="period" size="small" dataSource={report.periods} columns={moneyColumns(['cashOpening','prepaidReceipts','codReceipts','refundsPaid','supplierDeposit','supplierBalance','cashExpenses','cashClosing'])} pagination={false} scroll={{x:1500}}/>},
        {key:'shipments',label:'Vận đơn demo',children:<Table rowKey="fulfillmentId" size="small" dataSource={session.fulfillments} pagination={false} scroll={{x:800}} columns={[
          {title:'Đơn',dataIndex:'orderId'},{title:'Kho',dataIndex:'warehouseId'},{title:'Trạng thái',dataIndex:'status'},
          {title:'Vận đơn mô phỏng',render:(_,f)=>f.package?.trackingNumber||'—'},
          {title:'Cước VNĐ',render:(_,f)=>format(f.package?.quote.amount)}
        ]}/>},
      ]}/>
    </Card>
    <Card title={tr('emergency','Thử sức với tình huống khẩn cấp')}>
      <Space wrap><Button disabled={busy} onClick={()=>perform(async()=>setScenario(await runVnScenario('delay')))}>NCC chính trễ 14 ngày</Button>
        <Button disabled={busy} onClick={()=>perform(async()=>setScenario(await runVnScenario('surge')))}>Cầu tăng 50% trong 14 ngày</Button></Space>
      {scenario&&<><Alert style={{marginTop:16}} type={scenario.feasible?'success':'warning'} title={scenario.feasible?'Phương án khả thi trong cấu hình mô phỏng':'Nguồn lực chưa đủ, còn thiếu hàng hoặc trễ SLA'}/>
        <Table size="small" rowKey="key" pagination={false} dataSource={scenarioRows} columns={[{title:'Chỉ tiêu',dataIndex:'metric'},...['before','after','change'].map((k,i)=>({title:['Trước','Sau','Chênh lệch'][i],dataIndex:k,render:format}))]}/>
        <Descriptions size="small" items={[{key:'audit',label:'Chênh lệch cân bằng tồn',children:scenario.after.audit.difference},{key:'scope',label:'SLA',children:'Bàn giao đúng ngày / nhu cầu, không phải SLA giao tận tay'}]}/></>}
    </Card>
    <Collapse items={[{key:'notes',label:tr('notes','Nguồn dữ liệu, chính sách và cách đọc chỉ tiêu'),children:report.notes.map((note,i)=><p key={i}>{note}</p>)}]}/>
  </Space>;
}
