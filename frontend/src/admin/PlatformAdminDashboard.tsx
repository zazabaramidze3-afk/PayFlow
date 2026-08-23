import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import platformAdminApi from '../lib/platformAdminApi';
import styles from './PlatformAdminDashboard.module.scss';

// ==========================================================
// 📦 ტიპები — ზუსტად backend/src/routes/platformAdmin.ts-ის
// JSON response-ების ასლი (camelCase, DTO-სთვის).
// ==========================================================
type OrganizationStatus = 'trial' | 'active' | 'suspended' | 'cancelled';

interface OrganizationListItem {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  plan: string;
  trialEndsAt: string | null;
  createdAt: string;
  userCount: number;
  adminEmail: string | null;
  totalRevenue: number;
  receiptCount: number;
}

interface OrganizationDetail {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  plan: string;
  trialEndsAt: string | null;
  createdAt: string;
  users: Array<{ id: string; name: string; email: string | null; role: string; status: string }>;
  stats: { totalRevenue: number; receiptCount: number };
}

interface AuditLogItem {
  id: string;
  action: string;
  details: string | null;
  createdAt: string;
  adminName: string;
  adminEmail: string;
  organizationName: string | null;
}

type Tab = 'organizations' | 'audit-logs';

interface PlatformAdminDashboardProps {
  onLogout: () => void;
}

const STATUS_LABELS: Record<OrganizationStatus, string> = {
  trial: 'Trial',
  active: 'აქტიური',
  suspended: 'შეჩერებული',
  cancelled: 'გაუქმებული',
};

function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err) && typeof err.response?.data?.error === 'string') {
    return err.response.data.error;
  }
  return 'სერვერთან კავშირი ჩავარდა';
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('ka-GE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMoney(value: number): string {
  return `${value.toFixed(2)} ₾`;
}

export default function PlatformAdminDashboard({ onLogout }: PlatformAdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('organizations');

  const [organizations, setOrganizations] = useState<OrganizationListItem[] | null>(null);
  const [orgsError, setOrgsError] = useState('');
  const [loadingOrgs, setLoadingOrgs] = useState(true);

  const [auditLogs, setAuditLogs] = useState<AuditLogItem[] | null>(null);
  const [logsError, setLogsError] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [pendingStatusIds, setPendingStatusIds] = useState<Set<string>>(new Set());

  // 🔍 კომპანიის დეტალების მოდალი
  const [detailOrg, setDetailOrg] = useState<OrganizationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  // ⏳ Trial-გაგრძელების მოდალი
  const [trialModalOrg, setTrialModalOrg] = useState<{ id: string; name: string } | null>(null);
  const [extendDays, setExtendDays] = useState('30');
  const [trialSubmitting, setTrialSubmitting] = useState(false);
  const [trialError, setTrialError] = useState('');

  // ⚠️ Suspend-ის დადასტურების მოდალი (ერთადერთი დესტრუქციული action-ია —
  // რეალურ მომხმარებლებს ბლოკავს ლოგინზე, ამიტომ ერთი დამატებითი
  // დადასტურების ნაბიჯი გამართლებულია).
  const [suspendConfirmOrg, setSuspendConfirmOrg] = useState<{ id: string; name: string } | null>(null);

  const loadOrganizations = useCallback(async () => {
    setLoadingOrgs(true);
    setOrgsError('');
    try {
      const response = await platformAdminApi.get<OrganizationListItem[]>('/api/platform-admin/organizations');
      setOrganizations(response.data);
    } catch (err: unknown) {
      setOrgsError(getErrorMessage(err));
    } finally {
      setLoadingOrgs(false);
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    setLoadingLogs(true);
    setLogsError('');
    try {
      const response = await platformAdminApi.get<AuditLogItem[]>('/api/platform-admin/audit-logs?limit=100');
      setAuditLogs(response.data);
    } catch (err: unknown) {
      setLogsError(getErrorMessage(err));
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  useEffect(() => {
    if (activeTab === 'audit-logs' && auditLogs === null) {
      void loadAuditLogs();
    }
  }, [activeTab, auditLogs, loadAuditLogs]);

  const openDetail = async (orgId: string) => {
    setDetailLoading(true);
    setDetailError('');
    setDetailOrg(null);
    try {
      const response = await platformAdminApi.get<OrganizationDetail>(`/api/platform-admin/organizations/${orgId}`);
      setDetailOrg(response.data);
    } catch (err: unknown) {
      setDetailError(getErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const applyStatusChange = async (orgId: string, orgName: string, nextStatus: OrganizationStatus) => {
    setPendingStatusIds((prev) => new Set(prev).add(orgId));
    try {
      await platformAdminApi.patch(`/api/platform-admin/organizations/${orgId}/status`, { status: nextStatus });
      setOrganizations((prev) =>
        prev ? prev.map((org) => (org.id === orgId ? { ...org, status: nextStatus } : org)) : prev
      );
      toast.success(
        nextStatus === 'suspended' ? `"${orgName}" შეჩერდა` : `"${orgName}" გააქტიურდა`
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setPendingStatusIds((prev) => {
        const next = new Set(prev);
        next.delete(orgId);
        return next;
      });
    }
  };

  const handleSuspendConfirmed = async () => {
    if (!suspendConfirmOrg) return;
    const { id, name } = suspendConfirmOrg;
    setSuspendConfirmOrg(null);
    await applyStatusChange(id, name, 'suspended');
  };

  const openTrialModal = (orgId: string, orgName: string) => {
    setExtendDays('30');
    setTrialError('');
    setTrialModalOrg({ id: orgId, name: orgName });
  };

  const submitTrialExtend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trialModalOrg) return;
    const days = Number(extendDays);
    if (!Number.isInteger(days) || days <= 0 || days > 365) {
      setTrialError('შეიყვანეთ მთელი რიცხვი 1-დან 365-მდე');
      return;
    }

    setTrialSubmitting(true);
    setTrialError('');
    try {
      const response = await platformAdminApi.patch<{ id: string; name: string; trialEndsAt: string }>(
        `/api/platform-admin/organizations/${trialModalOrg.id}/trial`,
        { extendDays: days }
      );
      setOrganizations((prev) =>
        prev
          ? prev.map((org) =>
              org.id === trialModalOrg.id ? { ...org, trialEndsAt: response.data.trialEndsAt } : org
            )
          : prev
      );
      toast.success(`"${trialModalOrg.name}" — trial გაგრძელდა ${days} დღით`);
      setTrialModalOrg(null);
    } catch (err: unknown) {
      setTrialError(getErrorMessage(err));
    } finally {
      setTrialSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>🛡️ PayFlow Superadmin</h1>
          <p className={styles.subtitle}>პლატფორმის მართვის პანელი</p>
        </div>
        <button type="button" className={styles.logoutBtn} onClick={onLogout}>
          გასვლა
        </button>
      </header>

      <nav className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'organizations' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('organizations')}
        >
          კომპანიები
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'audit-logs' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('audit-logs')}
        >
          Action Log
        </button>
      </nav>

      <main className={styles.content}>
        {activeTab === 'organizations' && (
          <section>
            {loadingOrgs && <p className={styles.stateText}>იტვირთება...</p>}
            {!loadingOrgs && orgsError && <p className={styles.errorText}>⚠️ {orgsError}</p>}
            {!loadingOrgs && !orgsError && organizations && organizations.length === 0 && (
              <p className={styles.stateText}>ჯერ არცერთი კომპანია არ არის რეგისტრირებული.</p>
            )}
            {!loadingOrgs && !orgsError && organizations && organizations.length > 0 && (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>კომპანია</th>
                      <th>სტატუსი</th>
                      <th>Admin Email</th>
                      <th>მომხმარებელი</th>
                      <th>შემოსავალი</th>
                      <th>ჩეკები</th>
                      <th>Trial ვადა</th>
                      <th>რეგისტრაცია</th>
                      <th>მოქმედება</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizations.map((org) => {
                      const isPending = pendingStatusIds.has(org.id);
                      const isSuspended = org.status === 'suspended';
                      return (
                        <tr key={org.id}>
                          <td>
                            <button type="button" className={styles.orgNameBtn} onClick={() => void openDetail(org.id)}>
                              {org.name}
                            </button>
                            <div className={styles.orgSlug}>{org.slug}</div>
                          </td>
                          <td>
                            <span className={`${styles.badge} ${styles[`badge_${org.status}`]}`}>
                              {STATUS_LABELS[org.status]}
                            </span>
                          </td>
                          <td>{org.adminEmail ?? '—'}</td>
                          <td>{org.userCount}</td>
                          <td>{formatMoney(org.totalRevenue)}</td>
                          <td>{org.receiptCount}</td>
                          <td>{formatDate(org.trialEndsAt)}</td>
                          <td>{formatDate(org.createdAt)}</td>
                          <td>
                            <div className={styles.actionsCell}>
                              {isSuspended ? (
                                <button
                                  type="button"
                                  className={styles.actionBtnSuccess}
                                  disabled={isPending}
                                  onClick={() => void applyStatusChange(org.id, org.name, 'active')}
                                >
                                  გააქტიურე
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.actionBtnDanger}
                                  disabled={isPending}
                                  onClick={() => setSuspendConfirmOrg({ id: org.id, name: org.name })}
                                >
                                  შეაჩერე
                                </button>
                              )}
                              <button
                                type="button"
                                className={styles.actionBtnGhost}
                                disabled={isPending}
                                onClick={() => openTrialModal(org.id, org.name)}
                              >
                                +Trial
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeTab === 'audit-logs' && (
          <section>
            {loadingLogs && <p className={styles.stateText}>იტვირთება...</p>}
            {!loadingLogs && logsError && <p className={styles.errorText}>⚠️ {logsError}</p>}
            {!loadingLogs && !logsError && auditLogs && auditLogs.length === 0 && (
              <p className={styles.stateText}>ჯერ არცერთი Superadmin action არ ჩაწერილა.</p>
            )}
            {!loadingLogs && !logsError && auditLogs && auditLogs.length > 0 && (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>თარიღი</th>
                      <th>Superadmin</th>
                      <th>Action</th>
                      <th>კომპანია</th>
                      <th>დეტალები</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{formatDate(log.createdAt)}</td>
                        <td>{log.adminName}</td>
                        <td>{log.action}</td>
                        <td>{log.organizationName ?? '—'}</td>
                        <td>{log.details ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      {/* 🔍 კომპანიის დეტალების მოდალი */}
      {(detailLoading || detailOrg || detailError) && (
        <div className={styles.modalOverlay} onClick={() => { setDetailOrg(null); setDetailError(''); }}>
          <div className={styles.modalBody} onClick={(e) => e.stopPropagation()}>
            {detailLoading && <p className={styles.stateText}>იტვირთება...</p>}
            {detailError && <p className={styles.errorText}>⚠️ {detailError}</p>}
            {detailOrg && (
              <>
                <h2 className={styles.modalTitle}>{detailOrg.name}</h2>
                <p className={styles.modalSubtitle}>
                  {detailOrg.slug} · {STATUS_LABELS[detailOrg.status]} · {detailOrg.plan}
                </p>
                <div className={styles.detailStatsRow}>
                  <div className={styles.detailStat}>
                    <div className={styles.detailStatValue}>{formatMoney(detailOrg.stats.totalRevenue)}</div>
                    <div className={styles.detailStatLabel}>სრული შემოსავალი</div>
                  </div>
                  <div className={styles.detailStat}>
                    <div className={styles.detailStatValue}>{detailOrg.stats.receiptCount}</div>
                    <div className={styles.detailStatLabel}>ჩეკები</div>
                  </div>
                  <div className={styles.detailStat}>
                    <div className={styles.detailStatValue}>{detailOrg.users.length}</div>
                    <div className={styles.detailStatLabel}>მომხმარებელი</div>
                  </div>
                </div>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>სახელი</th>
                        <th>Email</th>
                        <th>როლი</th>
                        <th>სტატუსი</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailOrg.users.map((u) => (
                        <tr key={u.id}>
                          <td>{u.name}</td>
                          <td>{u.email ?? '—'}</td>
                          <td>{u.role}</td>
                          <td>{u.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className={styles.modalCloseBtn} onClick={() => setDetailOrg(null)}>
                  დახურვა
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ⏳ Trial-გაგრძელების მოდალი */}
      {trialModalOrg && (
        <div className={styles.modalOverlay} onClick={() => !trialSubmitting && setTrialModalOrg(null)}>
          <div className={styles.modalBody} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Trial-ის გაგრძელება</h2>
            <p className={styles.modalSubtitle}>{trialModalOrg.name}</p>
            <form onSubmit={submitTrialExtend} className={styles.modalForm}>
              <label className={styles.label}>რამდენი დღით გავაგრძელოთ?</label>
              <input
                type="number"
                min={1}
                max={365}
                value={extendDays}
                onChange={(e) => setExtendDays(e.target.value)}
                className={styles.input}
                autoFocus
              />
              {trialError && <p className={styles.errorText}>⚠️ {trialError}</p>}
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.actionBtnGhost}
                  disabled={trialSubmitting}
                  onClick={() => setTrialModalOrg(null)}
                >
                  გაუქმება
                </button>
                <button type="submit" className={styles.actionBtnSuccess} disabled={trialSubmitting}>
                  {trialSubmitting ? 'მიმდინარეობს...' : 'დადასტურება'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ⚠️ Suspend-ის დადასტურების მოდალი */}
      {suspendConfirmOrg && (
        <div className={styles.modalOverlay} onClick={() => setSuspendConfirmOrg(null)}>
          <div className={styles.modalBody} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>დარწმუნებული ხართ?</h2>
            <p className={styles.modalSubtitle}>
              "{suspendConfirmOrg.name}" შეჩერდება — ამ კომპანიის ყველა მომხმარებელს დაუბლოკდება შესვლა, სანამ ხელახლა არ გაააქტიურებთ.
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={styles.actionBtnGhost} onClick={() => setSuspendConfirmOrg(null)}>
                გაუქმება
              </button>
              <button type="button" className={styles.actionBtnDanger} onClick={() => void handleSuspendConfirmed()}>
                დიახ, შეაჩერე
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
