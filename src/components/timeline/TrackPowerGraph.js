/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import * as React from 'react';
import { Localized } from '@fluent/react';
import { withSize } from 'firefox-profiler/components/shared/WithSize';
import explicitConnect from 'firefox-profiler/utils/connect';
import { formatNumber } from 'firefox-profiler/utils/format-numbers';
import { bisectionRight } from 'firefox-profiler/utils/bisect';
import {
  getCommittedRange,
  getCounterSelectors,
  getProfileInterval,
} from 'firefox-profiler/selectors/profile';
import { getThreadSelectors } from 'firefox-profiler/selectors/per-thread';
import { GREY_50 } from 'photon-colors';
import { Tooltip } from 'firefox-profiler/components/tooltip/Tooltip';
import { EmptyThreadIndicator } from './EmptyThreadIndicator';

import type {
  CounterIndex,
  Counter,
  Thread,
  ThreadIndex,
  Milliseconds,
  CssPixels,
  StartEndRange,
} from 'firefox-profiler/types';

import type { SizeProps } from 'firefox-profiler/components/shared/WithSize';
import type { ConnectedProps } from 'firefox-profiler/utils/connect';

import './TrackPower.css';

/**
 * When adding properties to these props, please consider the comment above the component.
 */
type CanvasProps = {|
  +rangeStart: Milliseconds,
  +rangeEnd: Milliseconds,
  +counter: Counter,
  +maxCounterSampleCountsPerMs: number[],
  +interval: Milliseconds,
  +width: CssPixels,
  +height: CssPixels,
  +lineWidth: CssPixels,
|};

/**
 * This component controls the rendering of the canvas. Every render call through
 * React triggers a new canvas render. Because of this, it's important to only pass
 * in the props that are needed for the canvas draw call.
 */
class TrackPowerCanvas extends React.PureComponent<CanvasProps> {
  _canvas: null | HTMLCanvasElement = null;
  _requestedAnimationFrame: boolean = false;

  drawCanvas(canvas: HTMLCanvasElement): void {
    const {
      rangeStart,
      rangeEnd,
      counter,
      height,
      width,
      lineWidth,
      interval,
      maxCounterSampleCountsPerMs,
    } = this.props;
    if (width === 0) {
      // This is attempting to draw before the canvas was laid out.
      return;
    }

    const ctx = canvas.getContext('2d');
    const devicePixelRatio = window.devicePixelRatio;
    const deviceWidth = width * devicePixelRatio;
    const deviceHeight = height * devicePixelRatio;
    const deviceLineWidth = lineWidth * devicePixelRatio;
    const deviceLineHalfWidth = deviceLineWidth * 0.5;
    const innerDeviceHeight = deviceHeight - deviceLineWidth;
    const rangeLength = rangeEnd - rangeStart;
    const millisecondWidth = deviceWidth / rangeLength;
    const intervalWidth = interval * millisecondWidth;

    // Resize and clear the canvas.
    canvas.width = Math.round(deviceWidth);
    canvas.height = Math.round(deviceHeight);
    ctx.clearRect(0, 0, deviceWidth, deviceHeight);

    const sampleGroups = counter.sampleGroups;
    if (sampleGroups.length === 0) {
      // Gecko failed to capture samples for some reason and it shouldn't happen for
      // malloc counter. Print an error and do not draw anything.
      throw new Error('No sample group found for power counter');
    }

    const samples = counter.sampleGroups[0].samples;
    if (samples.length === 0) {
      // There's no reason to draw the samples, there are none.
      return;
    }

    const countRangePerMs = maxCounterSampleCountsPerMs[0];

    {
      // Draw the chart.
      //
      //                 ...--`
      //  1 ...---```..--      `--. 2
      //    |_____________________|
      //  4                        3
      //
      // Start by drawing from 1 - 2. This will be the top of all the peaks of the
      // power graph.

      ctx.lineWidth = deviceLineWidth;
      ctx.strokeStyle = GREY_50;
      ctx.fillStyle = '#73737388'; // Grey 50 with transparency.
      ctx.beginPath();

      // The x and y are used after the loop.
      let x = 0;
      let y = 0;
      let firstX = 0;
      for (let i = 0; i < samples.length; i++) {
        // Create a path for the top of the chart. This is the line that will have
        // a stroke applied to it.
        x = (samples.time[i] - rangeStart) * millisecondWidth;
        const sampleTimeDeltaInMs =
          i === 0 ? interval : samples.time[i] - samples.time[i - 1];
        const unitGraphCount =
          samples.count[i] / sampleTimeDeltaInMs / countRangePerMs;
        // Add on half the stroke's line width so that it won't be cut off the edge
        // of the graph.
        y =
          innerDeviceHeight -
          innerDeviceHeight * unitGraphCount +
          deviceLineHalfWidth;
        if (i === 0) {
          // This is the first iteration, only move the line, do not draw it. Also
          // remember this first X, as the bottom of the graph will need to connect
          // back up to it.
          firstX = x;
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      // The samples range ends at the time of the last sample, plus the interval.
      // Draw this last bit.
      ctx.lineTo(x + intervalWidth, y);

      // Don't do the fill yet, just stroke the top line. This will draw a line from
      // point 1 to 2 in the diagram above.
      ctx.stroke();

      // After doing the stroke, continue the path to complete the fill to the bottom
      // of the canvas. This continues the path to point 3 and then 4.

      // Create a line from 2 to 3.
      ctx.lineTo(x + intervalWidth, deviceHeight);

      // Create a line from 3 to 4.
      ctx.lineTo(firstX, deviceHeight);

      // The line from 4 to 1 will be implicitly filled in.
      ctx.fill();
    }
  }

  _scheduleDraw() {
    if (!this._requestedAnimationFrame) {
      this._requestedAnimationFrame = true;
      window.requestAnimationFrame(() => {
        this._requestedAnimationFrame = false;
        const canvas = this._canvas;
        if (canvas) {
          this.drawCanvas(canvas);
        }
      });
    }
  }

  _takeCanvasRef = (canvas: HTMLCanvasElement | null) => {
    this._canvas = canvas;
  };

  render() {
    this._scheduleDraw();

    return (
      <canvas className="timelineTrackPowerCanvas" ref={this._takeCanvasRef} />
    );
  }
}

type OwnProps = {|
  +counterIndex: CounterIndex,
  +lineWidth: CssPixels,
  +graphHeight: CssPixels,
|};

type StateProps = {|
  +threadIndex: ThreadIndex,
  +rangeStart: Milliseconds,
  +rangeEnd: Milliseconds,
  +counter: Counter,
  +maxCounterSampleCountsPerMs: number[],
  +interval: Milliseconds,
  +filteredThread: Thread,
  +unfilteredSamplesRange: StartEndRange | null,
|};

type DispatchProps = {||};

type Props = {|
  ...SizeProps,
  ...ConnectedProps<OwnProps, StateProps, DispatchProps>,
|};

type State = {|
  hoveredCounter: null | number,
  mouseX: CssPixels,
  mouseY: CssPixels,
|};

/**
 * The power track graph takes power use information from counters, and renders it as a
 * graph in the timeline.
 */
class TrackPowerGraphImpl extends React.PureComponent<Props, State> {
  state = {
    hoveredCounter: null,
    mouseX: 0,
    mouseY: 0,
  };

  _onMouseLeave = () => {
    this.setState({ hoveredCounter: null });
  };

  _onMouseMove = (event: SyntheticMouseEvent<HTMLDivElement>) => {
    const { pageX: mouseX, pageY: mouseY } = event;
    // Get the offset from here, and apply it to the time lookup.
    const { left } = event.currentTarget.getBoundingClientRect();
    const { width, rangeStart, rangeEnd, counter, interval } = this.props;
    const rangeLength = rangeEnd - rangeStart;
    const timeAtMouse = rangeStart + ((mouseX - left) / width) * rangeLength;

    if (counter.sampleGroups.length === 0) {
      // Gecko failed to capture samples for some reason and it shouldn't happen for
      // malloc counter. Print an error and bail out early.
      throw new Error('No sample group found for power counter');
    }
    const { samples } = counter.sampleGroups[0];

    if (
      timeAtMouse < samples.time[0] ||
      timeAtMouse > samples.time[samples.length - 1] + interval
    ) {
      // We are outside the range of the samples, do not display hover information.
      this.setState({ hoveredCounter: null });
    } else {
      // When the mouse pointer hovers between two points, select the point that's closer.
      let hoveredCounter;
      const bisectionCounter = bisectionRight(samples.time, timeAtMouse);
      if (bisectionCounter > 0 && bisectionCounter < samples.time.length) {
        const leftDistance = timeAtMouse - samples.time[bisectionCounter - 1];
        const rightDistance = samples.time[bisectionCounter] - timeAtMouse;
        if (leftDistance < rightDistance) {
          // Left point is closer
          hoveredCounter = bisectionCounter - 1;
        } else {
          // Right point is closer
          hoveredCounter = bisectionCounter;
        }
      } else {
        hoveredCounter = bisectionCounter;
      }

      if (hoveredCounter === samples.length) {
        // When hovering the last sample, it's possible the mouse is past the time.
        // In this case, hover over the last sample. This happens because of the
        // ` + interval` line in the `if` condition above.
        hoveredCounter = samples.time.length - 1;
      }

      this.setState({
        mouseX,
        mouseY,
        hoveredCounter,
      });
    }
  };

  _renderTooltip(counterIndex: number): React.Node {
    const { counter, interval } = this.props;
    const samples = counter.sampleGroups[0].samples;
    if (samples.length === 0) {
      // Gecko failed to capture samples for some reason and it shouldn't happen for
      // malloc counter. Print an error and bail out early.
      throw new Error('No sample found for power counter');
    }
    const powerUsageInPwh = samples.count[counterIndex]; // picowatt-hour
    const sampleTimeDeltaInMs =
      counterIndex === 0
        ? interval
        : samples.time[counterIndex] - samples.time[counterIndex - 1];
    const power =
      ((powerUsageInPwh * 1e-12) /* pWh->Wh */ / sampleTimeDeltaInMs) *
      1000 * // ms->s
      3600; // s->h
    let value;
    let l10nId;
    if (power > 1) {
      value = formatNumber(power, 3);
      l10nId = 'TrackPowerGraph--tooltip-power-watt';
    } else if (power === 0) {
      value = 0;
      l10nId = 'TrackPowerGraph--tooltip-power-watt';
    } else {
      value = formatNumber(power * 1000);
      l10nId = 'TrackPowerGraph--tooltip-power-milliwatt';
    }
    return (
      <div className="timelineTrackPowerTooltip">
        <Localized
          id={l10nId}
          vars={{ value }}
          elems={{
            em: <span className="timelineTrackPowerTooltipNumber"></span>,
          }}
        >
          <div className="timelineTrackPowerTooltipLine">
            Power: <em>{value}</em>
          </div>
        </Localized>
      </div>
    );
  }

  /**
   * Create a div that is a dot on top of the graph representing the current
   * height of the graph.
   */
  _renderDot(counterIndex: number): React.Node {
    const {
      counter,
      rangeStart,
      rangeEnd,
      graphHeight,
      width,
      lineWidth,
      maxCounterSampleCountsPerMs,
      interval,
    } = this.props;

    if (counter.sampleGroups.length === 0) {
      // Gecko failed to capture samples for some reason and it shouldn't happen for
      // malloc counter. Print an error and bail out early.
      throw new Error('No sample group found for power counter');
    }
    const { samples } = counter.sampleGroups[0];
    const rangeLength = rangeEnd - rangeStart;
    const left =
      (width * (samples.time[counterIndex] - rangeStart)) / rangeLength;

    if (samples.length === 0) {
      // Gecko failed to capture samples for some reason and it shouldn't happen for
      // power counter. Print an error and bail out early.
      throw new Error('No sample found for power counter');
    }
    const countRangePerMs = maxCounterSampleCountsPerMs[0];
    const sampleTimeDeltaInMs =
      counterIndex === 0
        ? interval
        : samples.time[counterIndex] - samples.time[counterIndex - 1];
    const unitSampleCount =
      samples.count[counterIndex] / sampleTimeDeltaInMs / countRangePerMs;
    const innerTrackHeight = graphHeight - lineWidth / 2;
    const top =
      innerTrackHeight - unitSampleCount * innerTrackHeight + lineWidth / 2;

    return <div style={{ left, top }} className="timelineTrackPowerGraphDot" />;
  }

  render() {
    const { hoveredCounter, mouseX, mouseY } = this.state;
    const {
      filteredThread,
      interval,
      rangeStart,
      rangeEnd,
      unfilteredSamplesRange,
      counter,
      graphHeight,
      width,
      lineWidth,
      maxCounterSampleCountsPerMs,
    } = this.props;

    return (
      <div
        className="timelineTrackPowerGraph"
        onMouseMove={this._onMouseMove}
        onMouseLeave={this._onMouseLeave}
      >
        <TrackPowerCanvas
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          counter={counter}
          height={graphHeight}
          width={width}
          lineWidth={lineWidth}
          interval={interval}
          maxCounterSampleCountsPerMs={maxCounterSampleCountsPerMs}
        />
        {hoveredCounter === null ? null : (
          <>
            {this._renderDot(hoveredCounter)}
            <Tooltip mouseX={mouseX} mouseY={mouseY}>
              {this._renderTooltip(hoveredCounter)}
            </Tooltip>
          </>
        )}
        <EmptyThreadIndicator
          thread={filteredThread}
          interval={interval}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          unfilteredSamplesRange={unfilteredSamplesRange}
        />
      </div>
    );
  }
}

export const TrackPowerGraph = explicitConnect<
  OwnProps,
  StateProps,
  DispatchProps
>({
  mapStateToProps: (state, ownProps) => {
    const { counterIndex } = ownProps;
    const counterSelectors = getCounterSelectors(counterIndex);
    const counter = counterSelectors.getCommittedRangeFilteredCounter(state);
    const { start, end } = getCommittedRange(state);
    const selectors = getThreadSelectors(counter.mainThreadIndex);
    return {
      counter,
      threadIndex: counter.mainThreadIndex,
      maxCounterSampleCountsPerMs:
        counterSelectors.getMaxRangeCounterSampleCountsPerMs(state),
      rangeStart: start,
      rangeEnd: end,
      interval: getProfileInterval(state),
      filteredThread: selectors.getFilteredThread(state),
      unfilteredSamplesRange: selectors.unfilteredSamplesRange(state),
    };
  },
  component: withSize<Props>(TrackPowerGraphImpl),
});
