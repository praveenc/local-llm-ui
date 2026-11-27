import { KiroDefaultAgent } from './KiroDefaultAgent';
import { KiroFolderSetting } from './KiroFolderSetting';

interface KiroChatDefaultsProps {
  /** Kiro is signed in: the settings show only then */
  signedIn: boolean;
  defaultAgent: string | undefined;
  onDefaultAgentChange: (agentId: string | undefined) => void;
  /** The folder saved (the Preferences footer says "Saved") */
  onFolderSaved?: () => void;
}

/** What a new Kiro chat starts with: its folder (D6) and its agent (D9) */
export function KiroChatDefaults({
  signedIn,
  defaultAgent,
  onDefaultAgentChange,
  onFolderSaved,
}: KiroChatDefaultsProps) {
  if (!signedIn) return null;
  return (
    <>
      <KiroFolderSetting onSaved={onFolderSaved} />
      <KiroDefaultAgent value={defaultAgent} onChange={onDefaultAgentChange} />
    </>
  );
}
