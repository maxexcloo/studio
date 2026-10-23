import { Menu } from "@mantine/core";
import { ImagePlus } from "lucide-react";
import { useLocation, useSearchParams } from "react-router";
import type { MediaItem } from "../../types";
import { useGeneration } from "../generation/GenerationProvider";
import { useGalleryReference } from "../generation/references";

export function ReferenceMediaAction({
  item,
  onApplied,
}: {
  item: MediaItem;
  onApplied: () => void;
}) {
  const { profile } = useGeneration();
  const reference = useGalleryReference();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  if (
    item.type !== "image" ||
    item.status !== "done" ||
    !item.url ||
    !(
      profile?.mediaInputs?.length ||
      profile?.capabilities.img2img ||
      profile?.capabilities.imageInput
    )
  )
    return null;
  return (
    <Menu.Item
      h={36}
      leftSection={<ImagePlus size={16} />}
      disabled={reference.isPending}
      closeMenuOnClick={false}
      onClick={() =>
        reference.mutate(item, {
          onSuccess: () => {
            onApplied();
            if (["/images", "/video"].includes(location.pathname)) {
              const next = new URLSearchParams(params);
              next.set("compose", "1");
              setParams(next, { replace: true });
            }
          },
        })
      }
    >
      Reference This Image
    </Menu.Item>
  );
}
