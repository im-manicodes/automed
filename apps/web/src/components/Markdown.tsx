import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Markdown renderizado con tipografía legible (sin HTML crudo: react-markdown lo escapa). */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
