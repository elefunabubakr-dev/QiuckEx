import { Redirect, useLocalSearchParams } from 'expo-router';

export default function ListingStubRedirect() {
  const params = useLocalSearchParams< { id?: string; viewerPublicKey?: string }>();
  const id = params.id;

  if (!id) {
    return <Redirect href='/marketplace' />;
  }

  const href = params.viewerPublicKey
    ? `/marketplace/${encodeURIComponent(id)}?viewerPublicKey=${encodeURIComponent(params.viewerPublicKey)}`
    : `/marketplace/${encodeURIComponent(id)}`;

  return <Redirect href={href as any} />;
}
