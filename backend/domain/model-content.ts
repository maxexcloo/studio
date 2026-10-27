/** A small image for the text model: base64 data and its type. */
export interface ModelImage {
  mime?: string;
  data: string;
}
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
/** A user message's content: the text alone, or with the images where the model reads them. */
export const userContent = (
  text: string,
  images: ModelImage[],
  vision: boolean,
): string | ContentPart[] =>
  vision && images.length
    ? [
        { type: "text", text },
        ...images.map((image) => ({
          type: "image_url" as const,
          image_url: { url: `data:${image.mime || "image/jpeg"};base64,${image.data}` },
        })),
      ]
    : text;
