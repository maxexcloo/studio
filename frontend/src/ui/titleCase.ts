const minor = new Set("a an and as at but by for in of on or per the to via vs with".split(" "));

/** A generated label in Title Case: "waiting for a worker" reads "Waiting for a Worker". */
export const titleCase = (text: string) => {
  const words = text.split(" ");
  return words
    .map((word, index) =>
      index > 0 && index < words.length - 1 && minor.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase()),
    )
    .join(" ");
};
