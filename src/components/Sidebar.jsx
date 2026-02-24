import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Users,
  DollarSign,
  Calendar,
  Target,
  FileText,
  Settings,
  ClipboardList,
  Receipt,
  Award,
  Mail,
  ClipboardCheck,
  Upload,
} from 'lucide-react';

const api = window.civicflow;

export function Sidebar({ activeView, onNavigate }) {
  const [logoUrl, setLogoUrl] = useState(null);
  const [orgName, setOrgName] = useState('Civicflow');
  const [logoVersion, setLogoVersion] = useState(0); // Cache-busting version
  const [grantsEnabled, setGrantsEnabled] = useState(true);
  const [currentRole, setCurrentRole] = useState('Admin');

  useEffect(() => {
    api?.roles?.getCurrent?.().then((r) => {
      if (r?.role) setCurrentRole(r.role);
    }).catch(() => {});
  }, []);

  const loadLogo = () => {
    Promise.all([
      api?.organization?.get?.(),
      api?.branding?.get?.(),
    ])
      .then(([org, branding]) => {
        const path = org?.logo_path || branding?.logoPath;
        setOrgName(org?.name || branding?.cboName || 'Civicflow');
        if (path) {
          try {
            // Convert absolute file path to app:// protocol URL
            // This avoids Electron security restrictions on file:// URLs
            // Ensure Windows drive letter colon is preserved (C:\ → C:/)
            let normalizedPath = path.replace(/\\/g, '/');
            // Ensure drive letter has colon (C/Users → C:/Users)
            if (/^[A-Za-z]\//.test(normalizedPath)) {
              normalizedPath = normalizedPath.replace(/^([A-Za-z])\//, '$1:/');
            }
            const appUrl = `app://${normalizedPath}`;
            setLogoUrl(appUrl);
            // Increment version to force image reload (cache-busting)
            setLogoVersion(v => v + 1);
          } catch (_) {
            setLogoUrl(null);
          }
        } else {
          setLogoUrl(null);
        }
      })
      .catch(() => {});
  };

  // Load logo on mount and when activeView changes
  useEffect(() => {
    let cancelled = false;
    loadLogo();
    return () => { cancelled = true; };
  }, [activeView]);

  // Refresh logo periodically, on window focus, and on custom events
  useEffect(() => {
    const handleFocus = () => {
      loadLogo();
    };
    
    // Listen for logo update events (dispatched after logo upload)
    const handleLogoUpdate = () => {
      loadLogo();
    };
    
    // Refresh on window focus (user might have uploaded logo in another tab/window)
    window.addEventListener('focus', handleFocus);
    
    // Listen for custom logo update event
    window.addEventListener('logo-updated', handleLogoUpdate);
    
    // Also poll every 3 seconds to catch logo updates (reduced from 5s for faster updates)
    const interval = setInterval(() => {
      loadLogo();
    }, 3000);
    
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('logo-updated', handleLogoUpdate);
      clearInterval(interval);
    };
  }, []);

  const isAdmin = currentRole === 'Admin';
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'events', label: 'Events', icon: Calendar },
    { id: 'campaigns', label: 'Campaigns', icon: Target },
    { id: 'expenditures', label: 'Expenditures', icon: Receipt },
    { id: 'meetings', label: 'Meetings', icon: ClipboardList },
    ...(grantsEnabled && isAdmin ? [{ id: 'grants', label: 'Grants', icon: Award }] : []),
    { id: 'finances', label: 'Financials', icon: DollarSign },
    { id: 'report-external-payment', label: 'Report Payment', icon: ClipboardCheck },
    ...(isAdmin ? [{ id: 'import-transactions', label: 'Import Transactions', icon: Upload }] : []),
    ...(isAdmin ? [{ id: 'pending-payments', label: 'Pending Payments', icon: ClipboardCheck }] : []),
    ...(isAdmin ? [{ id: 'analytics', label: 'Analytics', icon: FileText }] : []),
    ...(isAdmin ? [{ id: 'data-cleanup', label: 'Data Cleanup', icon: ClipboardList }] : []),
    { id: 'communications', label: 'Communications', icon: Mail },
    { id: 'reports-dashboard', label: 'Reports Dashboard', icon: FileText },
    { id: 'reports', label: 'Reports/Export', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="sidebar-container w-56 min-h-screen bg-slate-900 text-slate-100 flex flex-col border-r border-slate-700">
      <div className="p-5 border-b border-slate-700 flex items-center gap-3">
        {logoUrl ? (
          <img 
            src={`${logoUrl}?v=${logoVersion}&t=${Date.now()}`} 
            alt="" 
            className="h-10 w-10 rounded object-contain bg-white/10"
            onError={() => setLogoUrl(null)} // Fallback if image fails to load
          />
        ) : (
          <div className="h-10 w-10 rounded bg-emerald-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
            CF
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-white truncate">{orgName}</h1>
          <p className="text-xs text-slate-400 mt-0.5">Civicflow</p>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeView === id
                ? 'bg-emerald-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Icon size={20} strokeWidth={2} className="shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-700">
        <p className="text-xs text-slate-500 px-3">Civicflow v1.0.0</p>
      </div>
    </aside>
  );
}
