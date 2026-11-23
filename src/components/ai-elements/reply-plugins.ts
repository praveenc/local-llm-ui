/**
 * Rehype plugins for replies: Streamdown's defaults, except that no remote image loads.
 *
 * A reply can carry an image URL the model was led to write, for example by a prompt
 * injection in a web search result or an MCP tool output. The browser fetches it as soon
 * as it renders, with no click, so the URL's query string could send conversation text to
 * that server. Streamdown's sanitize step already drops data: and blob: image sources, so
 * replies show no images at all. Links stay as they are: Streamdown asks before opening one.
 */
import { type StreamdownProps, defaultRehypePlugins } from 'streamdown';

type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>;
// A plugin tuple is [plugin, options]; this is the plugin part
type RehypePlugin = Extract<RehypePlugins[number], readonly unknown[]>[0];

const [harden, hardenOptions] = defaultRehypePlugins.harden as [RehypePlugin, object];

export const replyRehypePlugins: RehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [
    harden,
    {
      ...hardenOptions,
      // No prefixes, so every http(s) image becomes "[Image blocked: <alt>]"
      allowedImagePrefixes: [],
      // Same look as Streamdown's "Image not available" fallback
      blockedImageClass: 'text-muted-foreground text-xs italic',
    },
  ],
];
