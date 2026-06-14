import { useEffect, useMemo, useRef, useState } from 'react';

const formatMemberLabel = (member) => {
  if (!member) return '';
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (member.email) return member.email;
  return `Member #${member.id}`;
};

const buildSearchIndex = (member) => {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
  const lastFirst = [member.last_name, member.first_name].filter(Boolean).join(', ').trim();
  const email = member.email || '';
  const phone = member.phone || '';
  return [name, lastFirst, email, phone, String(member.id || '')].join(' ').toLowerCase();
};

export default function MemberSearchSelect({
  members = [],
  value,
  onChange,
  placeholder = 'Search member...',
  disabled = false,
  maxResults = 40,
}) {
  const wrapperRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selectedMember = useMemo(
    () => members.find((m) => String(m.id) === String(value)),
    [members, value]
  );

  const filtered = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    const base = Array.isArray(members) ? members : [];
    if (!q) {
      return base.slice(0, maxResults);
    }
    return base.filter((m) => buildSearchIndex(m).includes(q)).slice(0, maxResults);
  }, [members, query, maxResults]);

  useEffect(() => {
    if (open) return;
    setQuery(selectedMember ? formatMemberLabel(selectedMember) : '');
  }, [selectedMember, open]);

  useEffect(() => {
    const handleClick = (event) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (member) => {
    onChange?.(member ? String(member.id) : '');
    setQuery(member ? formatMemberLabel(member) : '');
    setOpen(false);
  };

  const handleClear = () => {
    onChange?.('');
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="w-full">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100"
        />
        {!!value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700"
          >
            Clear
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500">No matching members.</div>
          ) : (
            filtered.map((member) => {
              const label = formatMemberLabel(member);
              const isActive = String(member.id) === String(value);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => handleSelect(member)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 ${
                    isActive ? 'bg-emerald-100/60 text-emerald-800' : 'text-slate-700'
                  }`}
                >
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-slate-500">
                    {[member.email, member.phone, member.id ? `Member #${member.id}` : null].filter(Boolean).join(' • ') || 'No additional details'}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
