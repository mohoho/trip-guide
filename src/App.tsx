import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { PublishContentPage } from './pages/content/PublishContentPage'
import { PublishEditorPage } from './pages/PublishEditorPage'
import { PublishListPage } from './pages/PublishListPage'
import { PublishPreviewPage } from './pages/PublishPreviewPage'
import { TourRoute } from './pages/TourRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/tour/:id" element={<TourRoute />} />
        <Route path="/publish" element={<PublishListPage />} />
        <Route path="/publish/:id" element={<PublishEditorPage />} />
        <Route path="/publish/:id/content" element={<PublishContentPage />} />
        <Route path="/publish/:id/preview" element={<PublishPreviewPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
