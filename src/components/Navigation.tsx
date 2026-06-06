type Tab = 'expenses' | 'settlement' | 'settings';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const tabs = [
  { id: 'expenses' as Tab, label: '支払い', icon: '💰' },
  { id: 'settlement' as Tab, label: '精算', icon: '💳' },
  { id: 'settings' as Tab, label: '設定', icon: '⚙️' },
];

export default function Navigation({ activeTab, onTabChange }: Props) {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t border-gray-100 shadow-lg z-40">
      <div className="flex pb-safe">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-3 transition-colors active:scale-95 transition-transform ${
              activeTab === tab.id ? 'text-primary' : 'text-ink-muted'
            }`}
          >
            <span className="text-xl">{tab.icon}</span>
            <span className={`text-xs font-medium ${activeTab === tab.id ? 'text-primary' : 'text-ink-muted'}`}>
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
