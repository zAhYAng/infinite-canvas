import axios from "axios";

import { V2API_BASE_URL } from "@/constant/env";
import type { ApiCallFormat, ModelChannel } from "@/stores/use-config-store";

export type CanvasHandoffChannel = Omit<ModelChannel, "apiFormat"> & Partial<Pick<ModelChannel, "apiFormat">> & { group?: string };

export type CanvasHandoffConfig = {
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channel: CanvasHandoffChannel;
    channels?: CanvasHandoffChannel[];
    models: string[];
    user?: {
        id: number;
        username: string;
    };
};

type CanvasHandoffResponse = {
    success: boolean;
    message?: string;
    data?: CanvasHandoffConfig;
};

export async function exchangeCanvasHandoff(handoff: string) {
    const response = await axios.post<CanvasHandoffResponse>(`${V2API_BASE_URL.replace(/\/+$/, "")}/api/canvas/handoff/exchange`, { handoff });
    if (!response.data.success || !response.data.data) {
        throw new Error(response.data.message || "画布登录已过期，请从 v2api 重新进入");
    }
    return response.data.data;
}
