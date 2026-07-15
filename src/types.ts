import type { Envelope } from "./lib/crypto";

export type Role = "insurer" | "broker";

export type KeyRecord = {
  version: string;
  createdAt: string;
  active: boolean;          // locally selected as the one to use
  publicPem: string;
  privatePem: string;
  fingerprint: string;
  keyId?: string;           // EcoHub key id once uploaded
  remote?: "uploaded" | "activated"; // status in the live Public Key Store
};

export type Credentials = {
  environment: string;
  idp: string;
  license: string;
  password: string;
  iak: string;
  orgId: string;
};

export type TechUser = {
  clientId: string;
  clientSecret: string;
  openIdConfigurationEndpoint: string;
  techUserCert: string;
  enrolledAt: string;
};

export type Profile = {
  id: string;
  name: string;
  role: Role;
  avatar: string;
  connected: boolean;
  credentials: Credentials;
  techUser: TechUser | null;
  encKeys: KeyRecord[];
  sigKeys: KeyRecord[];
};

// A transmitted SAF event sitting on the local bus (stands in for Kafka).
export type BusMessage = {
  id: string;
  fromProfileId: string;
  fromName: string;
  toName: string;        // recipient profile name (self-addressed in local mode)
  toIdp: string;
  topic: string;
  standardNs: string;
  subject: string;
  time: string;
  envelope: Envelope;
  // recipient's encryption public key + sender's signature public key travel
  // out-of-band here so the demo can decrypt/verify locally.
  recipientEncPublicPem: string;
  signerSigPublicPem: string;
  signerName: string;
  status: "sent" | "failed" | "pending";
};
