import { Redirect } from 'expo-router';

/** Unknown paths (e.g. when the web build is hosted under a sub-path) fall back to home. */
export default function NotFound() {
  return <Redirect href="/" />;
}
