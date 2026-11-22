const chronologySortLabels = {
  newest: "Newest First",
  oldest: "Oldest First",
};

export const ratingSortLabels = {
  liked: "Liked First",
  disliked: "Disliked First",
};

export const gallerySortGroups = [chronologySortLabels, ratingSortLabels];
export const gallerySortLabels = { ...chronologySortLabels, ...ratingSortLabels };
export type GallerySort = keyof typeof gallerySortLabels;
