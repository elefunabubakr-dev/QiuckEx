import { router } from 'expo-router';

export const PUSH_NOTIFICATION_TYPES = {
  listingDetail: 'listingDetail',
} as const;

export type PushNotificationType =
  (typeof PUSH_NOTIFICATION_TYPES)[keyof typeof PUSH_NOTIFICATION_TYPES];

export interface ListingDetailPayload {
  type: typeof PUSH_NOTIFICATION_TYPES.listingDetail;
  listingId?: string | null;
  id?: string | null;
  viewerPublicKey?: string | null;
  viewer?: string | null;
}

export type PushNotificationPayload = ListingDetailPayload;

export interface NotificationResponseLike {
  notification: {
    request: {
      content: {
        data?: Record<string, unknown>;
      };
    };
  };
}

function resolveListingId(payload: ListingDetailPayload): string | null {
  const id = payload.listingId ?? payload.id;
  return id == null ? null : String(id);
}

function resolveViewerPublicKey(payload: ListingDetailPayload): string | null {
  const key = payload.viewerPublicKey ?? payload.viewer;
  return key == null ? null : String(key);
}

function buildMarketplaceDetailParams(payload: ListingDetailPayload) {
  const listingId = resolveListingId(payload);
  if (!listingId) {
    return null;
  }

  const params: Record<string, string> = { id: listingId };
  const viewerPublicKey = resolveViewerPublicKey(payload);
  if (viewerPublicKey) {
    params.viewerPublicKey = viewerPublicKey;
  }

  return params;
}

function isListingDetailPayload(data: Record<string, unknown>): data is ListingDetailPayload {
  return data.type === PUSH_NOTIFICATION_TYPES.listingDetail;
}

export function routeFromNotification(payload: PushNotificationPayload): boolean {
  if (!isListingDetailPayload(payload as Record<string, unknown>)) {
    return false;
  }

  const params = buildMarketplaceDetailParams(payload);
  if (!params) {
    return false;
  }

  router.push({ pathname: '/marketplace/[id]', params });
  return true;
}

export function routeFromNotificationResponse(
  response: NotificationResponseLike,
): boolean {
  const data = response.notification.request.content.data;
  if (!data) {
    return false;
  }

  return routeFromNotification(data as PushNotificationPayload);
}
