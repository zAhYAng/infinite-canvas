import { CanvasNodeType, type CanvasNodeData, type CanvasStoryboardWorkflow } from "../types";

type StoryboardImageRunner = {
    findNode: (id: string) => CanvasNodeData | undefined;
    generateNode: (id: string, mode: "image", prompt: string) => Promise<void>;
    update: (workflowId: string, patch: Partial<CanvasStoryboardWorkflow>) => void;
};

type StoryboardVideoRunner = {
    findNode: (id: string) => CanvasNodeData | undefined;
    generateNode: (id: string, mode: "video", prompt: string) => Promise<void>;
    connect: (fromNodeId: string, toNodeId: string) => void;
    update: (workflowId: string, patch: Partial<CanvasStoryboardWorkflow>) => void;
};

export async function runStoryboardImages(workflow: CanvasStoryboardWorkflow, runner: StoryboardImageRunner) {
    if (workflow.state !== "awaiting_confirmation") return;
    runner.update(workflow.id, { state: "running", error: undefined });
    for (const imageNodeId of workflow.imageNodeIds) {
        const imageNode = runner.findNode(imageNodeId);
        if (!imageNode || imageNode.type !== CanvasNodeType.Image) {
            runner.update(workflow.id, { state: "failed", error: "分镜节点不存在" });
            return;
        }
        await runner.generateNode(imageNodeId, "image", imageNode.metadata?.prompt || "");
    }
    const hasFailure = workflow.imageNodeIds.some((id) => runner.findNode(id)?.metadata?.status === "error");
    runner.update(workflow.id, hasFailure ? { state: "failed", error: "至少一个分镜生成失败" } : { state: "awaiting_selection" });
}

export async function runStoryboardVideo(workflow: CanvasStoryboardWorkflow, imageNodeId: string, runner: StoryboardVideoRunner) {
    if (workflow.state !== "awaiting_selection") return;
    const imageNode = runner.findNode(imageNodeId);
    const videoNode = runner.findNode(workflow.videoNodeId);
    if (!imageNode?.metadata?.content || !videoNode || videoNode.type !== CanvasNodeType.Video) {
        runner.update(workflow.id, { state: "failed", error: "主图或视频节点不可用" });
        return;
    }
    runner.update(workflow.id, { state: "running", selectedImageId: imageNodeId, error: undefined });
    runner.connect(imageNode.id, videoNode.id);
    await runner.generateNode(videoNode.id, "video", videoNode.metadata?.prompt || workflow.videoPrompt);
    const failed = runner.findNode(videoNode.id)?.metadata?.status === "error";
    runner.update(workflow.id, failed ? { state: "failed", error: "视频生成失败" } : { state: "completed" });
}
