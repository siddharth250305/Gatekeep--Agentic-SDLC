// Light syntax highlighting for diff lines (Python / JS keywords, strings, numbers).
const KEYWORDS = new Set(['class','def','return','if','elif','else','for','while','in','import','from','as','with','try','except','raise','and','or','not','is','async','await','lambda','pass','yield','function','catch','self','let','const','var'])
const TYPES = new Set(['int','str','bool','float','tuple','list','dict','Redis','time','max','min','len','Optional','Union','null','undefined','Request','Response','Session','APIRouter','HTTPException','Depends'])
const CONSTS = new Set(['None','True','False','true','false'])
const TOKEN = /(#.*$|\/\/.*$)|((?:f|r|b)?"[^"]*"|(?:f|r|b)?'[^']*')|(\b\d+\b)|([A-Za-z_]\w*)|(\s+)|([^\s\w])/g

export function highlight(code) {
  if (!code) return ''
  const out = []; let prev = null; let i = 0; TOKEN.lastIndex = 0; let m
  while ((m = TOKEN.exec(code)) !== null) {
    const [full,,str,num,ident,ws] = m
    let cls = 'text-ink dark:text-[#f5f5f7]'
    if (m[1]) cls = 'text-faint dark:text-[#8e8e93] italic'
    else if (str) cls = 'text-[#17692e] dark:text-[#34c759] font-medium'
    else if (num) cls = 'text-[#8f4700] dark:text-[#ff9f0a]'
    else if (ident) {
      if (KEYWORDS.has(ident)) cls = 'text-accent dark:text-[#4da3ff] font-semibold'
      else if (ident === 'self') cls = 'text-[#d70015] dark:text-[#ff453a] font-medium'
      else if (CONSTS.has(ident)) cls = 'text-[#8f4700] dark:text-[#ff9f0a] font-semibold'
      else if (TYPES.has(ident)) cls = 'text-accent dark:text-[#4da3ff]'
      else if (prev === 'def' || prev === 'function' || prev === 'class') cls = 'text-ink dark:text-[#f5f5f7] font-semibold'
    } else if (!ws) cls = 'text-muted dark:text-[#a1a1aa]'
    if (ident) prev = ident; else if (!ws) prev = null
    out.push(<span key={i++} className={cls}>{full}</span>)
  }
  return out
}
