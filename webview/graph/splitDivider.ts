export type ResizeCallback = (topHeightPx: number) => void;

export class SplitDivider {
    private dragging = false;
    private startY = 0;
    private startHeight = 0;
    private topPane: HTMLElement;
    private bottomPane: HTMLElement;

    private static readonly MIN_TOP = 100;
    private static readonly MIN_BOTTOM = 60;

    constructor(
        private divider: HTMLElement,
        topPane: HTMLElement,
        bottomPane: HTMLElement,
        private onResize: ResizeCallback,
    ) {
        this.topPane = topPane;
        this.bottomPane = bottomPane;

        this.divider.addEventListener('mousedown', this.onMouseDown);
    }

    private onMouseDown = (e: MouseEvent): void => {
        e.preventDefault();
        this.dragging = true;
        this.startY = e.clientY;
        this.startHeight = this.topPane.getBoundingClientRect().height;

        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);
    };

    private onMouseMove = (e: MouseEvent): void => {
        if (!this.dragging) { return; }

        const delta = e.clientY - this.startY;
        const wrapper = this.topPane.parentElement;
        if (!wrapper) { return; }

        const totalHeight = wrapper.getBoundingClientRect().height - this.divider.offsetHeight;
        let newTopHeight = this.startHeight + delta;

        // Enforce min heights
        newTopHeight = Math.max(SplitDivider.MIN_TOP, newTopHeight);
        newTopHeight = Math.min(totalHeight - SplitDivider.MIN_BOTTOM, newTopHeight);

        this.topPane.style.height = `${newTopHeight}px`;
        this.topPane.style.flex = 'none';
        this.bottomPane.style.height = `${totalHeight - newTopHeight}px`;

        this.onResize(newTopHeight);
    };

    private onMouseUp = (): void => {
        this.dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
    };
}
