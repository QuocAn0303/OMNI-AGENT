/**
 * modules/auth/auth.e2e.test.js — E2E test cho luồng đăng ký → nâng cấp → CRM campaign
 * 
 * Tổng quan:
 * - Kiểm tra toàn bộ quy trình: đăng ký tài khoản mới → nhận free plan TRIAL → yêu cầu nâng cấp Pro → Admin duyệt → Admin tạo CRM campaign → kiểm tra features.
 * - Sử dụng database thật (chỉ chạy khi có DATABASE_URL).
 * 
 * Test steps:
 * - Step 1: Register → verify email → nhận free plan TRIAL
 * - Step 2: Request upgrade to Pro → tạo invoice PENDING
 * - Step 3: Admin approves (simulate) → subscription ACTIVE, invoice PAID
 * - Step 4: Admin tạo CRM campaign targeting Free users → send campaign
 * - Step 5: Kiểm tra plan features: Pro có HR, Free không có HR
 */
const prisma = require('../../config/prisma');
const authService = require('./auth.service');
const subscriptionService = require('../subscriptions/subscription.service');
const campaignService = require('../admin/admin-campaign.service');

jest.setTimeout(30000);

const describeFn = process.env.DATABASE_URL ? describe : describe.skip;

describeFn('E2E: Register → Free → Request Upgrade → Admin Approve → CRM Campaign', () => {
  const testEmail = `anle7091@gmail.com`;
  const companyName = `E2E Test ${Date.now()}`;
  let userId, tenantId, freePlan, proPlan, accessToken;

  afterAll(async () => {
    // Cleanup
    if (userId) {
      await prisma.subscriptionInvoice.deleteMany({ where: { tenant: { users: { some: { id: userId } } } } }).catch(() => {});
      await prisma.tenantSubscription.deleteMany({ where: { tenant: { users: { some: { id: userId } } } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
      await prisma.tenant.deleteMany({ where: { slug: { contains: 'e2e-test' } } }).catch(() => {});
    }
  });

  it('Step 1: Register new account → gets free plan TRIAL', async () => {
    const result = await authService.register({
      companyName,
      email: testEmail,
      password: 'test123456',
      fullName: 'E2E Tester',
    });

    expect(result.message).toBe('Vui lòng kiểm tra email để xác minh tài khoản');

    // Manually verify email for test
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(user).toBeDefined();
    expect(user.emailVerified).toBe(false);
    expect(user.registrationStatus).toBe('PENDING');

    await authService.verifyEmail(user.emailVerifyToken);
    const verified = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(verified.emailVerified).toBe(true);
    expect(verified.registrationStatus).toBe('ACTIVE');

    userId = verified.id;
    tenantId = verified.tenantId;

    // Check free plan assigned
    const sub = await subscriptionService.getTenantSubscription(tenantId);
    expect(sub).toBeDefined();
    expect(sub.plan.key).toBe('free');
    expect(sub.status).toBe('TRIAL');
  });

  it('Step 2: Request upgrade to Pro', async () => {
    const plans = await subscriptionService.getPlans();
    proPlan = plans.find(p => p.key === 'pro');
    expect(proPlan).toBeDefined();

    const result = await subscriptionService.requestUpgrade(tenantId, proPlan.id, userId);
    expect(result.invoice).toBeDefined();
    expect(result.invoice.status).toBe('PENDING');
    expect(result.invoice.invoiceCode).toContain('UPG-');
  });

  it('Step 3: Admin approves upgrade request', async () => {
    const invoices = await prisma.subscriptionInvoice.findMany({
      where: { invoiceCode: { startsWith: 'UPG-' }, tenantId },
    });
    expect(invoices.length).toBeGreaterThan(0);

    const upgradeInvoice = invoices[0];

    // Simulate admin approval: create new subscription + mark invoice PAID
    await prisma.tenantSubscription.updateMany({
      where: { tenantId, status: { in: ['ACTIVE', 'TRIAL'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + proPlan.durationDays);

    const newSub = await prisma.tenantSubscription.create({
      data: { tenantId, planId: proPlan.id, status: 'ACTIVE', startDate: new Date(), endDate },
    });

    await prisma.subscriptionInvoice.update({
      where: { id: upgradeInvoice.id },
      data: { status: 'PAID', paidAt: new Date(), subscriptionId: newSub.id },
    });

    // Verify subscription is now Pro
    const sub = await subscriptionService.getTenantSubscription(tenantId);
    expect(sub.plan.key).toBe('pro');
    expect(sub.status).toBe('ACTIVE');

    const updatedInvoice = await prisma.subscriptionInvoice.findUnique({ where: { id: upgradeInvoice.id } });
    expect(updatedInvoice.status).toBe('PAID');
  });

  it('Step 4: Admin creates a CRM campaign targeting Free users', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'E2E Free User Promo',
      channel: 'EMAIL',
      targetPlans: ['free'],
      subject: 'Ưu đãi đặc biệt',
      content: 'Nâng cấp ngay để nhận ưu đãi!',
      status: 'DRAFT',
    }, userId);

    expect(campaign.name).toBe('E2E Free User Promo');
    expect(campaign.status).toBe('DRAFT');
    expect(campaign.targetPlans).toEqual(['free']);

    const sent = await campaignService.sendCampaign(campaign.id, userId);
    expect(sent.status).toBe('DONE');
    expect(sent.sentCount).toBeGreaterThanOrEqual(0);
  });

  it('Step 5: Plan features correctly enforced', async () => {
    const features = await subscriptionService.getMyPlanFeatures(tenantId);
    expect(features).toBeDefined();
    expect(features.plan.key).toBe('pro');
    expect(features.features.allowedModules).toContain('hr');
    expect(features.features.allowedModules).toContain('crm');
    expect(features.isExpired).toBe(false);

    const isHrAllowed = features.isAllowed('hr');
    expect(isHrAllowed).toBe(true);

    // Free plan should NOT have HR
    const freePlan = (await subscriptionService.getPlans()).find(p => p.key === 'free');
    const freeModules = freePlan.features?.allowedModules || [];
    expect(freeModules).not.toContain('hr');
  });
});