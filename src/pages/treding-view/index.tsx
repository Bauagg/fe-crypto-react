import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import api from '@/utils/api/api'

interface Kline {
    open_time: number
    open: string
    high: string
    low: string
    close: string
    volume: string
    close_time: number
    is_closed: boolean
}

const LIMIT = 500
const LOAD_MORE_THRESHOLD = 10

const TredingView = () => {
    const [searchParams] = useSearchParams()
    const symbol = searchParams.get('symbol') ?? 'BTCUSDT'
    const interval = searchParams.get('interval') ?? '1h'

    const queryClient = useQueryClient()
    const queryKey = useMemo(() => ['klines', symbol, interval], [symbol, interval])

    const chartContainerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

    const {
        data,
        isLoading,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey,
        initialPageParam: undefined as number | undefined,
        queryFn: async ({ pageParam }) => {
            const res = await api.get<Kline[]>('/market/klines', {
                symbol,
                interval,
                limit: LIMIT,
                ...(pageParam ? { end_time: pageParam } : {}),
            })

            if (!res.success || !res.data) {
                throw new Error(res.message)
            }

            return res.data
        },
        getNextPageParam: (lastPage) => {
            if (lastPage.length < LIMIT) return undefined
            return lastPage[0].open_time - 1
        },
    })

    const klines = useMemo(() => {
        if (!data) return []
        const map = new Map<number, Kline>()
        for (const page of data.pages) {
            for (const k of page) {
                map.set(k.open_time, k)
            }
        }
        return Array.from(map.values()).sort((a, b) => a.open_time - b.open_time)
    }, [data])

    useEffect(() => {
        if (!chartContainerRef.current) return

        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            layout: {
                background: { color: '#ffffff' },
                textColor: '#1f2937',
            },
            grid: {
                vertLines: { color: '#e5e7eb' },
                horzLines: { color: '#e5e7eb' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        })

        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
        })

        chartRef.current = chart
        seriesRef.current = series

        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight,
                })
            }
        }
        window.addEventListener('resize', handleResize)

        const resizeObserver = new ResizeObserver(handleResize)
        resizeObserver.observe(chartContainerRef.current)

        return () => {
            window.removeEventListener('resize', handleResize)
            resizeObserver.disconnect()
            chart.remove()
            chartRef.current = null
            seriesRef.current = null
        }
    }, [])

    const isFirstLoadRef = useRef(true)
    const prevCountRef = useRef(0)

    useEffect(() => {
        if (klines.length === 0 || !seriesRef.current || !chartRef.current) return

        const candles = klines.map((k) => ({
            time: (k.open_time / 1000) as UTCTimestamp,
            open: Number(k.open),
            high: Number(k.high),
            low: Number(k.low),
            close: Number(k.close),
        }))

        const addedCount = klines.length - prevCountRef.current
        const timeScale = chartRef.current.timeScale()

        if (isFirstLoadRef.current) {
            // Presisi desimal menyesuaikan besar harga pair ini, supaya angka penuh selalu
            // tampil di axis/tooltip (mis. pair harga kecil butuh lebih dari 2 desimal,
            // sementara pair harga besar tetap presisi penuh tanpa dipendekkan jadi "1.2M").
            const referencePrice = candles[0].close
            let precision = 2
            if (referencePrice > 0 && referencePrice < 1) precision = 6
            else if (referencePrice < 100) precision = 4
            const minMove = 1 / 10 ** precision

            seriesRef.current.applyOptions({
                priceFormat: {
                    type: 'price',
                    precision,
                    minMove,
                },
            })

            seriesRef.current.setData(candles)
            timeScale.fitContent()
            isFirstLoadRef.current = false
        } else if (addedCount > 0) {
            const visibleRange = timeScale.getVisibleLogicalRange()
            seriesRef.current.setData(candles)
            if (visibleRange) {
                timeScale.setVisibleLogicalRange({
                    from: visibleRange.from + addedCount,
                    to: visibleRange.to + addedCount,
                })
            }
        } else {
            seriesRef.current.setData(candles)
        }

        prevCountRef.current = klines.length
    }, [klines])

    useEffect(() => {
        const chart = chartRef.current
        if (!chart) return

        const handleRangeChange = (
            range: { from: number; to: number } | null
        ) => {
            if (!range) return
            if (range.from < LOAD_MORE_THRESHOLD && hasNextPage && !isFetchingNextPage) {
                fetchNextPage()
            }
        }

        chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange)
        return () => {
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange)
        }
    }, [fetchNextPage, hasNextPage, isFetchingNextPage])

    useEffect(() => {
        const wsBase = import.meta.env.VITE_WS_URL
        const url = `${wsBase}market/ws?symbol=${symbol}&interval=${interval}`
        const ws = new WebSocket(url)

        ws.onmessage = (event) => {
            console.log('[ws] message', event.data)
            const kline = JSON.parse(event.data) as Kline

            if (seriesRef.current) {
                seriesRef.current.update({
                    time: (kline.open_time / 1000) as UTCTimestamp,
                    open: Number(kline.open),
                    high: Number(kline.high),
                    low: Number(kline.low),
                    close: Number(kline.close),
                })
            }

            queryClient.setQueryData<InfiniteData<Kline[]>>(queryKey, (old) => {
                if (!old) return old

                const pages = old.pages.map((page) => [...page])
                const lastPage = pages[pages.length - 1]
                const idx = lastPage.findIndex((k) => k.open_time === kline.open_time)

                if (idx >= 0) {
                    lastPage[idx] = kline
                } else {
                    lastPage.push(kline)
                }

                return { ...old, pages }
            })
        }

        return () => {
            ws.close()
        }
    }, [symbol, interval, queryClient, queryKey])

    return (
        <div className="h-dvh w-screen bg-white">
            {isLoading && <p className="text-gray-500">Loading chart...</p>}
            {isFetchingNextPage && <p className="text-gray-500">Loading more history...</p>}
            {error && <p className="text-red-500">{error.message}</p>}
            <div ref={chartContainerRef} className="h-full w-full" />
        </div>
    )
}

export default TredingView
