"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, Plus, Square, X } from "lucide-react";
import { Button } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasVideoTaskType } from "../types";
import type { AIReference, ReferenceRole } from "../types/reference";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { preflightGeneration } from "../utils/generation-preflight";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    referencePicking?: boolean;
    onStartReferencePick?: (nodeId: string, role?: ReferenceRole) => void;
    onRemoveReference?: (nodeId: string, referenceNodeId: string, role?: ReferenceRole, referenceUrl?: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], referencePicking = false, onStartReferencePick, onRemoveReference, onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const videoTaskType = normalizeVideoTaskType(node.metadata?.videoTaskType);
    const imageReferences = useMemo(() => mentionReferences.filter((reference) => reference.kind === "image" && reference.previewUrl), [mentionReferences]);
    const videoReferences = useMemo(() => (videoTaskType === "first-last-frame" ? firstLastFrameReferences(mentionReferences) : mentionReferences), [mentionReferences, videoTaskType]);
    const [prompt, setPrompt] = useState(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const preflight = useMemo(
		() =>
			mode === "image" || mode === "video"
				? preflightGeneration({
						config,
						mode,
						prompt,
						referenceCount: imageReferences.length,
						videoReferenceCount: mode === "video" ? videoReferences.filter((reference) => reference.kind === "video").length : 0,
						audioReferenceCount: mode === "video" ? videoReferences.filter((reference) => reference.kind === "audio").length : 0,
					})
				: null,
		[config, imageReferences.length, mode, prompt, videoReferences],
	);
	const blockingDiagnostic = preflight?.strict && !preflight.valid ? preflight.diagnostics[0] : null;

    useEffect(() => {
        setPrompt(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    }, [isEditingExistingContent, node.id]);

    useEffect(() => {
        const frame = requestAnimationFrame(() => textareaRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (!isEditingExistingContent) onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return;
        onGenerate(node.id, mode, text);
        setPrompt("");
    };

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {mode === "image" ? (
                <div className="mb-2">
                    <ReferenceStrip references={imageReferences} active={referencePicking} theme={theme} onAdd={() => onStartReferencePick?.(node.id)} onRemove={(reference) => onRemoveReference?.(node.id, reference.nodeId, reference.role, reference.referenceUrl)} />
                </div>
            ) : null}
            {mode === "video" ? (
                <div className="mb-2 space-y-2">
                    <VideoTaskTabs value={videoTaskType} theme={theme} onChange={(value) => onConfigChange(node.id, videoTaskTypePatch(value, node.metadata?.references))} />
                    <ReferenceStrip
                        references={videoReferences}
                        active={referencePicking}
                        theme={theme}
                        onAdd={(role) => onStartReferencePick?.(node.id, role)}
                        onRemove={(reference) => onRemoveReference?.(node.id, reference.nodeId, reference.role, reference.referenceUrl)}
                        slots={videoTaskType === "first-last-frame" ? firstLastFrameSlots : undefined}
                        maxItems={videoTaskType === "first-last-frame" ? 2 : undefined}
                    />
                </div>
            ) : null}
            <CanvasResourceMentionTextarea
                ref={textareaRef}
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-24 w-full resize-none rounded-xl border px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
            />

            <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker className="!h-10 !min-w-0 !flex-1" fullWidth config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !w-[132px] !max-w-[132px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker className="!h-10 !min-w-0 !flex-1" fullWidth config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !w-[132px] !max-w-[132px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker className="!h-10 !min-w-0 !flex-1" fullWidth config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !w-[132px] !max-w-[132px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker className="!h-10 !min-w-0 !flex-1" fullWidth config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} />
                    )}
                </div>
                <Button
                    type="primary"
                    className="!h-10 !min-w-[72px] shrink-0 !rounded-full !px-3"
                    danger={isRunning}
					disabled={!isRunning && (!prompt.trim() || Boolean(blockingDiagnostic))}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={isRunning ? "停止生成" : "生成"}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">停止</span>
                            </>
                        ) : (
                            <>
                                <span className="text-xs font-medium">生成</span>
                                <ArrowUp className="size-4" />
                            </>
                        )}
                    </span>
                </Button>
            </div>
			{blockingDiagnostic ? <div className="mt-2 text-xs" style={{ color: theme.node.muted }}>{blockingDiagnostic.message}</div> : null}
        </div>
    );
}

const videoTaskOptions: Array<{ value: CanvasVideoTaskType; label: string }> = [
    { value: "t2v", label: "文生视频" },
    { value: "i2v", label: "图生视频" },
    { value: "first-last-frame", label: "首尾帧" },
];

function VideoTaskTabs({ value, theme, onChange }: { value: CanvasVideoTaskType; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (value: CanvasVideoTaskType) => void }) {
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {videoTaskOptions.map((item) => {
                const active = value === item.value;
                return (
                    <button
                        key={item.value}
                        type="button"
                        className="h-8 rounded-full border px-3 text-xs font-medium transition hover:opacity-85"
                        style={{
                            borderColor: active ? theme.node.activeStroke : theme.node.stroke,
                            background: active ? theme.toolbar.activeBg : "transparent",
                            color: active ? theme.node.text : theme.node.muted,
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => onChange(item.value)}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}

function ReferenceStrip({
    references,
    active,
    theme,
    onAdd,
    onRemove,
    maxItems,
    slots,
}: {
    references: CanvasResourceReference[];
    active: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onAdd: (role?: ReferenceRole) => void;
    onRemove: (reference: CanvasResourceReference) => void;
    maxItems?: number;
    slots?: Array<{ role: ReferenceRole; label: string }>;
}) {
    const canAdd = maxItems === undefined || references.length < maxItems;
    const visibleReferences = slots ? slots.map((slot) => references.find((reference) => reference.role === slot.role) || null) : references;
    return (
        <div className="thin-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto">
            {!slots ? (
                <ReferenceAddButton active={active} disabled={!canAdd} label="参考" theme={theme} onClick={() => onAdd()} />
            ) : null}
            {visibleReferences.map((reference, index) => {
                const slot = slots?.[index];
                if (!reference && slot) return <ReferenceAddButton key={slot.role} active={active} disabled={!canAdd} label={slot.label} theme={theme} onClick={() => onAdd(slot.role)} />;
                if (!reference) return null;
                return <ReferenceThumb key={`${reference.id}:${reference.role || index}`} reference={reference} label={slot?.label || reference.label} theme={theme} onRemove={() => onRemove(reference)} />;
            })}
        </div>
    );
}

function ReferenceAddButton({ active, disabled, label, theme, onClick }: { active: boolean; disabled: boolean; label: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onClick: () => void }) {
    return (
        <button
            type="button"
            className="flex size-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-45"
            style={{ borderColor: active ? theme.node.activeStroke : theme.node.stroke, color: active ? theme.node.text : theme.node.muted, background: active ? theme.toolbar.activeBg : "transparent" }}
            disabled={disabled}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            <Plus className="size-4" />
            <span>{label}</span>
        </button>
    );
}

function ReferenceThumb({ reference, label, theme, onRemove }: { reference: CanvasResourceReference; label: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onRemove: () => void }) {
    return (
        <div className="group relative size-14 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }} title={reference.title}>
            {reference.kind === "image" && reference.previewUrl ? (
                <img src={reference.previewUrl} alt={reference.title} draggable={false} className="size-full object-cover" />
            ) : reference.kind === "video" && reference.previewUrl ? (
                <video src={reference.previewUrl} muted preload="metadata" className="size-full bg-black object-cover" />
            ) : (
                <div className="grid size-full place-items-center px-1 text-center text-[11px] font-medium" style={{ background: theme.node.fill, color: theme.node.muted }}>
                    {reference.kind === "audio" ? "音频" : reference.kind === "video" ? "视频" : "参考"}
                </div>
            )}
            <span className="absolute bottom-1 left-1 max-w-[46px] truncate rounded-md px-1 py-0.5 text-[10px] font-medium text-white shadow" style={{ background: "rgba(0,0,0,.48)" }}>
                {label}
            </span>
            <button
                type="button"
                className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/55 text-white opacity-0 shadow-sm transition group-hover:opacity-100"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    onRemove();
                }}
                aria-label="移除参考"
            >
                <X className="size-3" />
            </button>
        </div>
    );
}

const firstLastFrameSlots: Array<{ role: ReferenceRole; label: string }> = [
    { role: "first_frame", label: "首帧" },
    { role: "last_frame", label: "尾帧" },
];

function firstLastFrameReferences(references: CanvasResourceReference[]) {
    return firstLastFrameSlots.map((slot) => references.find((reference) => reference.role === slot.role)).filter((reference): reference is CanvasResourceReference => Boolean(reference));
}

function videoTaskTypePatch(value: CanvasVideoTaskType, references: AIReference[] | undefined): Partial<CanvasNodeData["metadata"]> {
    if (value !== "first-last-frame") return { videoTaskType: value, references: (references || []).map((reference) => ({ ...reference, role: "" as const })) };
    return { videoTaskType: value, references: assignFirstLastFrameRoles(references || []) };
}

function assignFirstLastFrameRoles(references: AIReference[]): AIReference[] {
    let needsFirstFrame = !references.some((reference) => reference.role === "first_frame");
    let needsLastFrame = !references.some((reference) => reference.role === "last_frame");
    return references.map((reference) => {
        if (reference.role || reference.kind !== "image") return reference;
        if (needsFirstFrame) {
            needsFirstFrame = false;
            return { ...reference, role: "first_frame" };
        }
        if (needsLastFrame) {
            needsLastFrame = false;
            return { ...reference, role: "last_frame" };
        }
        return reference;
    });
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function normalizeVideoTaskType(value: unknown): CanvasVideoTaskType {
    return value === "i2v" || value === "first-last-frame" ? value : "t2v";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    return {
        ...globalConfig,
        model: node.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model),
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
