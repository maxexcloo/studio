export const gallerySortLabels = {
  newest: "Newest First",
  oldest: "Oldest First",
  liked: "Liked First",
  disliked: "Disliked First",
};

export type GallerySort = keyof typeof gallerySortLabels;
