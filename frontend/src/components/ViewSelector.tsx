import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '../hooks/useNavigation';
import { fetchViews } from '../api';

export function ViewSelector() {
  const { selectedWorldView, selectedView, setSelectedView } = useNavigation();

  const { data: views = [] } = useQuery({
    queryKey: ['views', selectedWorldView?.id],
    queryFn: () => fetchViews(selectedWorldView!.id),
    enabled: !!selectedWorldView,
  });

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (event.target.value === '') {
      setSelectedView(null);
    } else {
      const view = views.find(v => v.id === Number(event.target.value));
      if (view) {
        setSelectedView(view);
      }
    }
  };

  // Filter active views
  const activeViews = views.filter(v => v.isActive);

  if (activeViews.length === 0) {
    return null;
  }

  return (
    <div style={{ marginBottom: '16px' }}>
      <label htmlFor="view-select" style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
        View
      </label>
      <select
        id="view-select"
        value={selectedView?.id ?? ''}
        onChange={handleChange}
        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
      >
        <option value="">All regions</option>
        {activeViews.map((view) => (
          <option key={view.id} value={view.id}>
            {view.name}
          </option>
        ))}
      </select>
    </div>
  );
}
