import { version } from "../../../package.json";

export const postedVersion = version;

export const postedBrand = {
  mark: "/brand/posted-mark.png",
  themeColor: {
    light: "#f7f7f6",
    dark: "#060605",
  },
} as const;

export function PostedMark() {
  return (
    <img
      src={postedBrand.mark}
      alt=""
      aria-hidden="true"
      width={32}
      height={32}
      className="size-8 shrink-0 object-contain"
    />
  );
}
