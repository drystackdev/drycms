import GithubSyncSettings from "./GithubSyncSettings.js";
import { logout } from "../store/auth.js";

export default function GithubSetup({ onSaved }: { onSaved: () => void }) {
  return <main class="auth-single"><section class="card"><GithubSyncSettings setupOnly onSaved={onSaved} onSignOut={() => void logout()} /></section></main>;
}
