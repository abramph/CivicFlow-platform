import React, { useState, useEffect, Component } from 'react';
import { Layout } from './components/Layout.jsx';
import { Dashboard } from './views/Dashboard.jsx';
import { Members } from './views/Members.jsx';
import { MemberProfile } from './views/MemberProfile.jsx';
import { Finances } from './views/Finances.jsx';
import { Campaigns } from './views/Campaigns.jsx';
import { CampaignDetail } from './views/CampaignDetail.jsx';
import { Events } from './views/Events.jsx';
import { EventDetail } from './views/EventDetail.jsx';
import { Meetings } from './views/Meetings.jsx';
import { Expenditures } from './views/Expenditures.jsx';
import { Reports } from './views/Reports.jsx';
import { ReportsDashboard } from './views/ReportsDashboard.jsx';
import { Settings } from './views/Settings.jsx';
import { SetupWizard } from './views/SetupWizard.jsx';
import { ActivationScreen } from './views/ActivationScreen.jsx';
import Activation from './renderer/pages/Activation.jsx';
import { Grants } from './views/Grants.jsx';
import { GrantDetail } from './views/GrantDetail.jsx';
import { Communications } from './views/Communications.jsx';
import { ImportWizard } from './views/ImportWizard.jsx';
import { PendingPayments } from './views/PendingPayments.jsx';
import { ImportTransactions } from './views/ImportTransactions.jsx';
import { DataCleanup } from './views/DataCleanup.jsx';
import { ExternalPaymentReport } from './views/ExternalPaymentReport.jsx';
import { Analytics } from './views/Analytics.jsx';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('Renderer crash:', error);
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong.</div>;
    }
    return this.props.children;
  }
}

const VIEWS = {
  dashboard: Dashboard,
  members: Members,
  'member-profile': MemberProfile,
  finances: Finances,
  campaigns: Campaigns,
  'campaign-detail': CampaignDetail,
  events: Events,
  'event-detail': EventDetail,
  expenditures: Expenditures,
  meetings: Meetings,
  reports: Reports,
  'reports-dashboard': ReportsDashboard,
  'pending-payments': PendingPayments,
  analytics: Analytics,
  'report-external-payment': ExternalPaymentReport,
  'import-transactions': ImportTransactions,
  'data-cleanup': DataCleanup,
  settings: Settings,
  'setup-wizard': SetupWizard,
  grants: Grants,
  'grant-detail': GrantDetail,
  communications: Communications,
  'data-import': ImportWizard,
};

const SETUP_STORAGE_KEY = 'civicflow_setup_complete';

function routeFromHash() {
  const rawHash = window.location.hash || '';
  const hashPath = rawHash.replace(/^#\/?/, '').trim();
  if (!hashPath) return null;
  const [rawPath, rawQuery = ''] = hashPath.split('?');
  const path = rawPath === 'setup' ? 'setup-wizard' : rawPath;
  if (!VIEWS[path]) return null;
  const params = Object.fromEntries(new URLSearchParams(rawQuery).entries());
  return { viewId: path, params };
}

function setHashForView(viewId, params = {}) {
  const hashPath = viewId === 'setup-wizard' ? 'setup' : viewId;
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  const nextHash = query ? `#/${hashPath}?${query}` : `#/${hashPath}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

export function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [viewParams, setViewParams] = useState({});
  const [setupComplete, setSetupComplete] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState(null);
  const searchParams = new URLSearchParams(window.location.search);
  const isActivationMode = searchParams.get('mode') === 'activation';
  const activationReason = searchParams.get('reason');

  const openActivationWindow = () => {
    const next = new URL(window.location.href);
    next.searchParams.set('mode', 'activation');
    window.location.href = next.toString();
  };

  // Startup check: setup status
  useEffect(() => {
    let cancelled = false;
    const setupPromise = window.civicflow?.organization?.getSetupStatus?.();
    Promise.all([
      setupPromise && typeof setupPromise.then === 'function' ? setupPromise : Promise.resolve(null),
    ])
      .then(([setup]) => {
        if (cancelled) return;

        const storedFlag = localStorage.getItem(SETUP_STORAGE_KEY) === 'true';
        const apiFlag = typeof setup?.setupCompleted === 'boolean'
          ? setup.setupCompleted
          : (typeof setup?.completed === 'boolean' ? setup.completed : null);
        const isComplete = storedFlag || apiFlag === true;

        localStorage.setItem(SETUP_STORAGE_KEY, isComplete ? 'true' : 'false');
        setSetupComplete(isComplete);

        const hashRoute = routeFromHash();
        if (!isComplete) {
          setActiveView('setup-wizard');
          setHashForView('setup-wizard');
          return;
        }

        if (!hashRoute || hashRoute.viewId === 'setup-wizard') {
          setActiveView('dashboard');
          setViewParams({});
          setHashForView('dashboard');
          return;
        }

        setActiveView(hashRoute.viewId);
        setViewParams(hashRoute.params || {});
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSetupChecked(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!setupChecked) return;

    const onHashChange = () => {
      const hashRoute = routeFromHash();

      if (!setupComplete) {
        setActiveView('setup-wizard');
        setViewParams({});
        setHashForView('setup-wizard');
        return;
      }

      if (!hashRoute || hashRoute.viewId === 'setup-wizard') {
        setActiveView('dashboard');
        setViewParams({});
        setHashForView('dashboard');
        return;
      }

      setActiveView(hashRoute.viewId);
      setViewParams(hashRoute.params || {});
    };

    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [setupChecked, setupComplete]);

  useEffect(() => {
    const wait = () => {
      if (window.civicflow && window.civicflow.license) {
        window.civicflow.license.getStatus().then(setLicenseStatus);
      } else {
        setTimeout(wait, 100);
      }
    };
    wait();
  }, []);

  const onNavigate = (viewId, params = {}) => {
    if (!setupComplete && viewId !== 'setup-wizard') {
      setActiveView('setup-wizard');
      setHashForView('setup-wizard');
      return;
    }
    setActiveView(viewId);
    setViewParams(params);
    setHashForView(viewId, params);
  };

  const handleSetupComplete = () => {
    localStorage.setItem(SETUP_STORAGE_KEY, 'true');
    setSetupComplete(true);
    setViewParams({});
    setActiveView('dashboard');
    window.location.hash = '#/dashboard';
  };

  const ViewComponent = VIEWS[activeView] ?? Dashboard;

  if (!setupChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!licenseStatus) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <p className="text-slate-500">Checking license…</p>
      </div>
    );
  }

  const trialDaysRemaining = Number(licenseStatus?.daysRemaining ?? 0);
  const trialIsValid = licenseStatus?.status === 'trial' && trialDaysRemaining > 0;

  if (!licenseStatus.valid && !trialIsValid) {
    return (
      <Activation onLicensed={async () => setLicenseStatus(await window.civicflow.license.getStatus())} />
    );
  }

  if (isActivationMode) {
    return (
      <ActivationScreen reason={activationReason} />
    );
  }

  if (!setupComplete || activeView === 'setup-wizard') {
    return (
      <div className="min-h-screen bg-slate-50">
        <SetupWizard onComplete={handleSetupComplete} />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {trialIsValid && (
        <div className="w-full bg-amber-50 border-b border-amber-200 px-4 py-2 text-amber-800 text-sm flex items-center justify-between">
          <span>{`Trial: ${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} remaining`}</span>
          <button
            type="button"
            onClick={openActivationWindow}
            className="px-3 py-1 rounded border border-amber-300 bg-white hover:bg-amber-100 text-amber-900 font-medium"
          >
            Activate License
          </button>
        </div>
      )}
      <Layout activeView={activeView} onNavigate={onNavigate}>
        {activeView === 'member-profile' ? (
          <MemberProfile memberId={viewParams.memberId} onBack={() => onNavigate('members')} />
        ) : activeView === 'campaign-detail' ? (
          <CampaignDetail campaignId={viewParams.campaignId} onNavigate={onNavigate} />
        ) : activeView === 'event-detail' ? (
          <EventDetail eventId={viewParams.eventId} onNavigate={onNavigate} />
        ) : activeView === 'reports' ? (
          <Reports
            initialReportType={viewParams.reportType}
            initialCampaignId={viewParams.campaignId}
            initialEventId={viewParams.eventId}
          />
        ) : activeView === 'reports-dashboard' ? (
          <ReportsDashboard initialTypes={viewParams.types} />
        ) : activeView === 'grant-detail' ? (
          <GrantDetail grantId={viewParams.grantId} onNavigate={onNavigate} />
        ) : activeView === 'setup-wizard' ? (
          <SetupWizard onComplete={() => onNavigate('dashboard')} />
        ) : activeView === 'report-external-payment' ? (
          <ExternalPaymentReport onNavigate={onNavigate} initialMemberId={viewParams.memberId} />
        ) : (
          <ViewComponent onNavigate={onNavigate} onOpenActivation={openActivationWindow} />
        )}
      </Layout>
    </ErrorBoundary>
  );
}
