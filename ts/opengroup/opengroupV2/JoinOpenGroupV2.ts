import {
  getV2OpenGroupRoomByRoomId,
  OpenGroupV2Room,
  removeV2OpenGroupRoom,
} from '../../data/opengroups';
import { ConversationController } from '../../session/conversations';
import { PromiseUtils } from '../../session/utils';
import { forceSyncConfigurationNowIfNeeded } from '../../session/utils/syncUtils';
import {
  getOpenGroupV2ConversationId,
  openGroupV2CompleteURLRegex,
  prefixify,
  publicKeyParam,
} from '../utils/OpenGroupUtils';
import { OpenGroupManagerV2 } from './OpenGroupManagerV2';

// Inputs that should work:
// https://sessionopengroup.co/main?public_key=658d29b91892a2389505596b135e76a53db6e11d613a51dbd3d0816adffb231c
// http://sessionopengroup.co/main?public_key=658d29b91892a2389505596b135e76a53db6e11d613a51dbd3d0816adffb231c
// sessionopengroup.co/main?public_key=658d29b91892a2389505596b135e76a53db6e11d613a51dbd3d0816adffb231c (does NOT go to HTTPS)
// https://143.198.213.225:443/main?public_key=658d29b91892a2389505596b135e76a53db6e11d613a51dbd3d0816adffb231c
// 143.198.213.255:80/main?public_key=658d29b91892a2389505596b135e76a53db6e11d613a51dbd3d0816adffb231c

export function parseOpenGroupV2(urlWithPubkey: string): OpenGroupV2Room | undefined {
  const lowerCased = urlWithPubkey.toLowerCase();
  try {
    if (!openGroupV2CompleteURLRegex.test(lowerCased)) {
      throw new Error('regex fail');
    }
    // prefix the URL if it does not have a prefix
    const prefixedUrl = prefixify(lowerCased);
    // new URL fails if the protocol is not explicit
    const url = new URL(prefixedUrl);

    let serverUrl = `${url.protocol}//${url.host}`;
    if (url.port) {
      serverUrl += `:${url.port}`;
    }

    const room: OpenGroupV2Room = {
      serverUrl,
      roomId: url.pathname.slice(1), // remove first '/'
      serverPublicKey: url.search.slice(publicKeyParam.length + 1), // remove the '?' and the 'public_key=' header
    };
    return room;
  } catch (e) {
    window.log.error('Invalid Opengroup v2 join URL:', lowerCased);
  }
  return undefined;
}

/**
 * Join an open group using the v2 logic.
 *
 * If you only have an string with all details in it, use parseOpenGroupV2() to extract and check the URL is valid
 *
 * @param server The server URL to join, defaults to https if protocol is not set
 * @param room The room id to join
 * @param publicKey The server publicKey. It comes from the joining link. (or is already here for the default open group server)
 */
export async function joinOpenGroupV2(
  room: OpenGroupV2Room,
  fromSyncMessage: boolean
): Promise<void> {
  if (!room.serverUrl || !room.roomId || room.roomId.length < 2 || !room.serverPublicKey) {
    return;
  }

  const serverUrl = room.serverUrl.toLowerCase();
  const roomId = room.roomId.toLowerCase();
  const publicKey = room.serverPublicKey.toLowerCase();
  const prefixedServer = prefixify(serverUrl);

  const alreadyExist = await getV2OpenGroupRoomByRoomId({ serverUrl, roomId });
  const conversationId = getOpenGroupV2ConversationId(serverUrl, roomId);
  const existingConvo = ConversationController.getInstance().get(conversationId);

  if (alreadyExist && existingConvo) {
    window.log.warn('Skipping join opengroupv2: already exists');
    return;
  } else if (existingConvo) {
    // we already have a convo associated with it. Remove everything related to it so we start fresh
    window.log.warn('leaving before rejoining open group v2 room', conversationId);
    await ConversationController.getInstance().deleteContact(conversationId);
  }

  // Try to connect to server
  try {
    const conversation = await PromiseUtils.timeout(
      OpenGroupManagerV2.getInstance().attemptConnectionV2OneAtATime(
        prefixedServer,
        roomId,
        publicKey
      ),
      20000
    );

    if (!conversation) {
      window.log.warn('Failed to join open group v2');
      throw new Error(window.i18n('connectToServerFail'));
    }

    // here we managed to connect to the group.
    // if this is not a Sync Message, we should trigger one
    if (!fromSyncMessage) {
      await forceSyncConfigurationNowIfNeeded();
    }
  } catch (e) {
    window.log.error('Could not join open group v2', e);
    throw new Error(e);
  }
}