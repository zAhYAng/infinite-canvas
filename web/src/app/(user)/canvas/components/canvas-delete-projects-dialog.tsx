"use client";

import { App, Button, Modal } from "antd";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const { message } = App.useApp();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const blockedCount = useCanvasStore((state) => state.projects.filter((project) => ids.includes(project.id) && project.nodes.some((node) => node.metadata?.videoTask && !node.metadata.content)).length);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const confirm = () => {
        const { deletedIds, blockedIds } = deleteProjects(ids);
        if (deletedIds.length) {
            cleanupImages();
            removeSelectedIds(deletedIds);
        }
        if (blockedIds.length) message.warning(`${blockedIds.length} 个画布仍有待完成的视频任务，已保留`);
        setDeleteIds([]);
    };

    return (
        <Modal
            title="删除画布？"
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>取消</Button>
                    <Button danger type="primary" onClick={confirm}>
                        删除
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">将删除 {ids.length} 个画布，里面的节点和连线也会一起移除。</p>
            {blockedCount ? <p className="mt-2 text-sm text-amber-600">其中 {blockedCount} 个画布仍有待完成的视频任务，不会被删除。</p> : null}
        </Modal>
    );
}
