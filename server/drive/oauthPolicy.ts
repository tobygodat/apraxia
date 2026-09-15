import type { VerifiedSession } from "../auth/verifySession.js";
import {
  GOOGLE_OAUTH_TTL_MS,
  GoogleOAuthPolicyError,
  createGoogleOAuthPolicy,
  type GoogleOAuthCallback,
} from "../google/oauthPolicy.js";
import { DRIVE_PROVIDER } from "./driveProvider.js";

export const DRIVE_SCOPES = DRIVE_PROVIDER.scopes;
export const DRIVE_OAUTH_TTL_MS = GOOGLE_OAUTH_TTL_MS;

export class DriveOAuthPolicyError extends GoogleOAuthPolicyError {
  constructor() {
    super(DRIVE_PROVIDER);
  }
}

export const driveOAuthPolicy = createGoogleOAuthPolicy(
  DRIVE_PROVIDER,
  () => new DriveOAuthPolicyError(),
);

export type DriveOAuthCallback = GoogleOAuthCallback;

export const getDriveOAuthRedirectUri = (appUrl: unknown): string =>
  driveOAuthPolicy.redirectUri(appUrl);
export const assertDriveMutationRequest = (request: Request, appUrl: unknown): void =>
  driveOAuthPolicy.assertMutationRequest(request, appUrl);
export const createDriveOAuthAttempt = (
  session: VerifiedSession,
  configuration: { readonly appUrl: string; readonly clientId: string },
  now?: Date,
) => driveOAuthPolicy.createAttempt(session, configuration, now);
export const parseDriveOAuthCallback = (callbackUrl: string, appUrl: string): DriveOAuthCallback =>
  driveOAuthPolicy.parseCallback(callbackUrl, appUrl);
export const createDriveOAuthConsumeCommand = (
  callback: DriveOAuthCallback,
  session: VerifiedSession,
  appUrl: string,
) => driveOAuthPolicy.createConsumeCommand(callback, session, appUrl);
export const validateGrantedDriveScopes = (value: unknown): readonly string[] =>
  driveOAuthPolicy.validateGrantedScopes(value);
