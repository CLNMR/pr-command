import {Button, LinkButton, type ButtonProps} from '@primer/react'
import {KeybindingHint} from '@primer/react/experimental'

type Props = ButtonProps & {hotkey: string; href?: string; target?: string; rel?: string}

/** Primer button that shows its keyboard shortcut (hidden on touch-only devices). Renders a link with `href`. */
export function KbdButton({hotkey, variant, href, ...rest}: Props) {
  const hint = () => (
    <span className="kbd-hint">
      <KeybindingHint keys={hotkey} variant={variant === 'primary' ? 'onPrimary' : 'normal'} size="small" />
    </span>
  )
  return href ? (
    <LinkButton variant={variant} href={href} {...rest} trailingVisual={hint} />
  ) : (
    <Button variant={variant} {...rest} trailingVisual={hint} />
  )
}
