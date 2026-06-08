import { OMIE_BASE_URL } from "./constants.js";
import { createOmieRequestBody, type OmieRequestBody } from "./omie-request.js";

export interface OmieClientConfig {
  appKey: string;
  appSecret: string;
  baseUrl?: string;
}

export interface OmieAuthBody<TParam> extends OmieRequestBody<TParam> {
  app_key: string;
  app_secret: string;
}

export class OmieClient {
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;

  constructor(config: OmieClientConfig) {
    if (!config.appKey?.trim() || !config.appSecret?.trim()) {
      throw new Error("OMIE appKey and appSecret are required");
    }
    this.appKey = config.appKey;
    this.appSecret = config.appSecret;
    this.baseUrl = config.baseUrl?.trim() || OMIE_BASE_URL;
  }

  createAuthBody<TParam>(call: string, param: TParam): OmieAuthBody<TParam> {
    const body = createOmieRequestBody(call, param);
    return {
      ...body,
      app_key: this.appKey,
      app_secret: this.appSecret
    };
  }

  async call<TParam, TResponse>(
    endpoint: string,
    call: string,
    param: TParam
  ): Promise<TResponse> {
    const body = this.createAuthBody(call, param);

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`OMIE HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as TResponse;
    return data;
  }
}
