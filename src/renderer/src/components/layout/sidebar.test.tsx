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

  it('未实现的页面标注所属阶段，已实现的不标注', () => {
    render(<Sidebar />)

    const time = screen.getByRole('button', { name: /工时记录/ })
    expect(time).toHaveTextContent('P4')

    const dashboard = screen.getByRole('button', { name: /概览/ })
    expect(dashboard).not.toHaveTextContent('P0')

    const settings = screen.getByRole('button', { name: /设置/ })
    expect(settings).not.toHaveTextContent('P4')
  })
})
