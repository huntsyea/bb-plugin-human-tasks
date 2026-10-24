import {
  experimental_Icon,
  type ExperimentalIconProps,
} from "@get-bb/plugin-sdk/app";
import { PLUGIN_ICONS } from "../../icons";

const HostIcon = experimental_Icon;

export type IconName = string;
export type IconProps = ExperimentalIconProps;

/**
 * This plugin's own glyphs render locally, so they don't take up names in
 * bb's shared icon registry; every other name goes to the host icon set.
 */
export function Icon(props: IconProps) {
  const Local = PLUGIN_ICONS[props.name];
  if (Local) return <Local className={props.className} />;
  return <HostIcon {...props} />;
}
