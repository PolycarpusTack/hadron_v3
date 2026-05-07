import { useRef } from 'react';
import {
  LayoutDashboard, Bot, Puzzle, Ticket, Bug, Database,
  SlidersHorizontal, Wrench, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { SettingsSection } from './types';
import { isIntegrationSection } from './types';

interface Props {
  activeSection: SettingsSection;
  onSelect: (s: SettingsSection) => void;
  integrationsOpen: boolean;
  onToggleIntegrations: () => void;
}

interface SectionItem {
  kind: 'section';
  section: SettingsSection;
  label: string;
  icon: React.FC<{ className?: string }>;
  indent?: boolean;
}

interface IntegrationsHeader {
  kind: 'integrations-header';
}

type NavEntry = SectionItem | IntegrationsHeader;

const ROOT_ITEMS: SectionItem[] = [
  { kind: 'section', section: 'dashboard',   label: 'Dashboard',   icon: LayoutDashboard },
  { kind: 'section', section: 'ai-provider', label: 'AI Provider', icon: Bot },
];

const INTEGRATION_ITEMS: SectionItem[] = [
  { kind: 'section', section: 'jira',           label: 'JIRA',           icon: Ticket,   indent: true },
  { kind: 'section', section: 'sentry',         label: 'Sentry',         icon: Bug,      indent: true },
  { kind: 'section', section: 'knowledge-base', label: 'Knowledge Base', icon: Database, indent: true },
];

const BOTTOM_ITEMS: SectionItem[] = [
  { kind: 'section', section: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { kind: 'section', section: 'maintenance', label: 'Maintenance', icon: Wrench },
];

function buildEntries(integrationsOpen: boolean): NavEntry[] {
  return [
    ...ROOT_ITEMS,
    { kind: 'integrations-header' },
    ...(integrationsOpen ? INTEGRATION_ITEMS : []),
    ...BOTTOM_ITEMS,
  ];
}

export default function SettingsSidebar({ activeSection, onSelect, integrationsOpen, onToggleIntegrations }: Props) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const entries = buildEntries(integrationsOpen);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      itemRefs.current[idx + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      itemRefs.current[idx - 1]?.focus();
    }
  };

  const handleIntegrationsClick = () => {
    if (isIntegrationSection(activeSection)) {
      // Child active: only toggle tree visibility, don't navigate
      onToggleIntegrations();
    } else {
      // Navigate to default child (JIRA) — tree opens via derived state in shell
      onSelect('jira');
    }
  };

  const sectionTabIdx = (section: SettingsSection) =>
    activeSection === section ? 0 : -1;
  const integrationsTabIdx = isIntegrationSection(activeSection) ? 0 : -1;

  const btnClass = (active: boolean, indent = false) =>
    [
      'w-full flex items-center gap-2.5 rounded-lg text-left transition-colors',
      indent ? 'pl-8 py-1.5 text-xs' : 'px-3 py-2 text-sm',
      active
        ? 'bg-emerald-500/15 text-emerald-400'
        : 'text-gray-400 hover:text-gray-200 hover:bg-white/5',
    ].join(' ');

  return (
    <nav
      aria-label="Settings navigation"
      className="w-44 shrink-0 border-r border-white/8 py-3 overflow-y-auto"
    >
      <ul role="list" className="space-y-0.5 px-2">
        {entries.map((entry, idx) => {
          if (entry.kind === 'integrations-header') {
            return (
              <li key="integrations-header">
                <button
                  ref={el => { itemRefs.current[idx] = el; }}
                  aria-expanded={integrationsOpen}
                  tabIndex={integrationsTabIdx}
                  onClick={handleIntegrationsClick}
                  onKeyDown={e => handleKeyDown(e, idx)}
                  className={`${btnClass(isIntegrationSection(activeSection))} justify-between px-3 py-2 text-sm`}
                >
                  <span className="flex items-center gap-2.5">
                    <Puzzle className="w-4 h-4 shrink-0" />
                    Integrations
                  </span>
                  {integrationsOpen
                    ? <ChevronDown className="w-3.5 h-3.5" />
                    : <ChevronRight className="w-3.5 h-3.5" />
                  }
                </button>
              </li>
            );
          }

          const active = activeSection === entry.section;
          return (
            <li key={entry.section}>
              <button
                ref={el => { itemRefs.current[idx] = el; }}
                aria-current={active ? 'page' : undefined}
                tabIndex={sectionTabIdx(entry.section)}
                onClick={() => onSelect(entry.section)}
                onKeyDown={e => handleKeyDown(e, idx)}
                className={btnClass(active, entry.indent)}
              >
                <entry.icon className="w-4 h-4 shrink-0" />
                {entry.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
