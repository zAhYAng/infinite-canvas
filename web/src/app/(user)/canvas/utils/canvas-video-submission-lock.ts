export type CanvasVideoSubmissionLockManager = {
    request<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
};

export function canvasVideoSubmissionLockName(projectId: string, nodeId: string) {
    return `infinite-canvas:video-submission:${encodeURIComponent(projectId)}:${encodeURIComponent(nodeId)}`;
}

export async function withCanvasVideoSubmissionLock<T>(projectId: string, nodeId: string, callback: () => Promise<T> | T, lockManager: CanvasVideoSubmissionLockManager | null | undefined = browserLockManager()): Promise<T> {
    if (!lockManager) throw new Error("Web Locks API is unavailable; video submission was blocked to prevent duplicate billing");
    return lockManager.request(canvasVideoSubmissionLockName(projectId, nodeId), callback);
}

function browserLockManager(): CanvasVideoSubmissionLockManager | null {
    if (typeof navigator === "undefined") return null;
    const locks = (navigator as Navigator & { locks?: CanvasVideoSubmissionLockManager }).locks;
    return locks || null;
}
