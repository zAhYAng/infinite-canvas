export type ReferenceKind = "image" | "video" | "audio";
export type ReferenceRole = "" | "mask" | "first_frame" | "last_frame";

export type AIReference = {
    url: string;
    name: string;
    role: ReferenceRole;
    kind: ReferenceKind;
    mime: string;
};
