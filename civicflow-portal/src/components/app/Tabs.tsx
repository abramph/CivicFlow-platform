"use client";

import { useId, useState, type ReactNode } from "react";

export type TabDefinition = { id: string; label: string };

/** Renders all panels server-side (passed as children) and toggles visibility
 * client-side with the native `hidden` attribute -- content stays in the DOM
 * (no extra round-trip per tab), and `hidden` already keeps inactive panels'
 * interactive elements out of the tab order and off-screen for assistive tech. */
export function Tabs({ tabs, children }: { tabs: TabDefinition[]; children: ReactNode }) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id);
  const baseId = useId();
  const panels = Array.isArray(children) ? children : [children];

  return (
    <div>
      <div role="tablist" aria-label="Member profile sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={
                selected
                  ? "rounded-t-lg border border-b-0 border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800"
                  : "rounded-t-lg border border-transparent px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="space-y-6 pt-6">
        {tabs.map((tab, index) => (
          <div key={tab.id} id={`${baseId}-panel-${tab.id}`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab.id}`} hidden={tab.id !== activeTab}>
            {panels[index]}
          </div>
        ))}
      </div>
    </div>
  );
}
