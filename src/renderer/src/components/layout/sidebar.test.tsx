import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { navItems } from '@/config/navigation'
import { useNavigationStore } from '@/stores/navigation-store'
import { Sidebar } from './sidebar'

describe('侧边栏', () => {
  beforeEach(() => {
    useNavigationStore.setState({ active: 'dashboard' })
  })

  it('显示全部导航项与品牌名', () => {
    render(<Sidebar />)

    expect(screen.getByText('Atelier')).toBeInTheDocument()
    for (const item of navItems) {
      expect(screen.getByRole('button', { name: new RegExp(item.label) })).toBeInTheDocument()
    }
  })

  it('默认高亮概览页', () => {
    render(<Sidebar />)

    expect(screen.getByRole('button', { name: /概览/ })).toHaveAttribute('aria-current', 'page')
  })

  it('点击导航项会切换当前页面', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: /日历/ }))

    expect(useNavigationStore.getState().active).toBe('calendar')
  })

  it('已实现的页面不再标注阶段角标', () => {
    render(<Sidebar />)

    for (const item of navItems) {
      const button = screen.getByRole('button', { name: new RegExp(item.label) })
      expect(button).not.toHaveTextContent(item.phase)
    }
  })
})
