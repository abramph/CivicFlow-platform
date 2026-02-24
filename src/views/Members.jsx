import { MemberDirectory } from '../renderer/components/MemberDirectory.jsx';

export function Members({ onNavigate }) {
  return <MemberDirectory onNavigate={onNavigate} title="Members" />;
}
