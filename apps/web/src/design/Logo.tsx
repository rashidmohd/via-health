import logoUrl from './sessio-logo.svg'

export function Logo({ height = 22 }: { height?: number }) {
  return <img className="logo" src={logoUrl} alt="Sessio" height={height} />
}
