'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(['ACTIVE', 'PAID']);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function csvSet(value, normalizer = item => String(item || '').trim()) {
  return new Set(String(value || '').split(',').map(normalizer).filter(Boolean));
}

function asTime(value) {
  const time = value == null ? NaN : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function evaluateAccess({ user, entitlement = null, now = Date.now(), trialDays = 3, lifetimeEmails = '', lifetimeUserIds = '' } = {}) {
  if (!user?.id) return { allowed: false, state: 'AUTH_REQUIRED', reason: 'Entre para usar o THEIBS.' };

  const nowMs = asTime(now) ?? Date.now();
  const emails = lifetimeEmails instanceof Set ? lifetimeEmails : csvSet(lifetimeEmails, normalizeEmail);
  const userIds = lifetimeUserIds instanceof Set ? lifetimeUserIds : csvSet(lifetimeUserIds);
  const isLifetime = entitlement?.access_kind === 'LIFETIME' || entitlement?.lifetime === true ||
    emails.has(normalizeEmail(user.email)) || userIds.has(String(user.id));
  if (isLifetime) return { allowed: true, state: 'LIFETIME', reason: 'Acesso vitalício.', trialEndsAt: null, daysRemaining: null };

  const status = String(entitlement?.status || '').toUpperCase();
  const accessEnd = asTime(entitlement?.current_period_end || entitlement?.access_until);
  if (ACTIVE_STATUSES.has(status) && (accessEnd == null || accessEnd > nowMs)) {
    return { allowed: true, state: 'ACTIVE', reason: 'Acesso permanente.', trialEndsAt: null, daysRemaining: null,
      accessUntil: accessEnd == null ? null : new Date(accessEnd).toISOString() };
  }

  const createdAt = asTime(user.created_at || user.createdAt);
  const explicitTrialEnd = asTime(entitlement?.trial_ends_at);
  const days = Number.isFinite(Number(trialDays)) && Number(trialDays) > 0 ? Number(trialDays) : 3;
  const trialEnd = explicitTrialEnd ?? (createdAt == null ? null : createdAt + days * DAY_MS);
  if (trialEnd != null && trialEnd > nowMs) {
    return { allowed: true, state: 'TRIAL', reason: 'Período grátis ativo.', trialEndsAt: new Date(trialEnd).toISOString(),
      daysRemaining: Math.max(1, Math.ceil((trialEnd - nowMs) / DAY_MS)) };
  }

  return { allowed: false, state: 'EXPIRED', reason: 'Seus 3 dias grátis terminaram. Compre o acesso para continuar.',
    trialEndsAt: trialEnd == null ? null : new Date(trialEnd).toISOString(), daysRemaining: 0 };
}

module.exports = { DAY_MS, ACTIVE_STATUSES, normalizeEmail, csvSet, evaluateAccess };
