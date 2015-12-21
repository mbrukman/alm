import * as ui from "../ui";
import * as csx from "csx";
import * as React from "react";
import * as tab from "./tab";
import {server,cast} from "../../socket/socketClient";
import * as commands from "../commands/commands";
import * as utils from "../../common/utils";
import * as d3 from "d3";
import {Types} from "../../socket/socketContract";
import * as $ from "jquery";
import * as styles from "../styles/styles";
type FileDependency = Types.FileDependency;
let EOL = '\n';

let {inputBlackStyle} = styles.Input;

/**
 * The styles
 */
require('./dependencyView.less');

import {CodeEditor} from "../codemirror/codeEditor";

export interface Props extends tab.ComponentProps {
}
export interface State {
}

/**
 * This is a thin wrapper around `CodeEditor` with the following key motivations
 * - All server code must go through here
 * - All tab type stuff must go through here
 */
@ui.Radium
export class DependencyView extends ui.BaseComponent<Props, State> implements tab.Component {

    constructor(props: Props) {
        super(props);
        this.filePath = utils.getFilePathFromUrl(props.url);
        this.state = {
        };
    }

    refs: {
        [string: string]: any;
        graphRoot: HTMLDivElement;
        controlRoot: HTMLDivElement;
        filter: HTMLInputElement;
    }

    filePath: string;
    componentDidMount() {
        server.getDependencies({}).then((res) => {
            new RenderGraph({
                dependencies: res.links,
                graphRoot:$(this.refs.graphRoot),
                controlRoot:$(this.refs.controlRoot),
                display:(node) => {
                }
            });
            setTimeout(this.focusFilter,100);
        });
    }
    componentWillUnmount(){
        this.disposible.dispose();
    }

    focusFilter = () => {
        this.refs.filter.focus();
    }

    render() {
        return (
            <div
                className="dependency-view"
                style={csx.extend(csx.vertical,csx.flex, {position:'relative'})}>
                <div ref="graphRoot" style={csx.extend(csx.vertical,csx.flex)}>
                    {/* Graph goes here */}
                </div>

                <div ref="controlRoot" className="graph-controls" style={[csx.newLayer,csx.horizontalReverse]}>
                    <div style={[{width:'200px'},csx.vertical]}>
                        <div className="control-zoom">
                            <a className="control-zoom-in" href="#" title="Zoom in" />
                            <a className="control-zoom-out" href="#" title="Zoom out" />
                        </div>
                        <div style={[styles.padded1,csx.flexRoot]}>
                            <input ref="filter" id="filter"
                            style={[inputBlackStyle,csx.flex]}
                            placeholder="Filter"/>
                        </div>
                        <div className="copy-message">
                            <button className="btn btn-xs">Copy Messages</button>
                        </div>
                        <div className="general-messages" />
                    </div>
               </div>

            </div>
        );
    }

    /**
     * TAB implementation
     */
    focus = () => {
    }

    save = () => {
    }

    close = () => {
    }

    gotoPosition = (position: EditorPosition) => {
    }

    search = (options: FindOptions) => {
    }

    hideSearch = () => {
    }

    findNext = (options: FindOptions) => {
    }

    findPrevious = (options: FindOptions) => {
    }

    replaceNext = (newText: string) => {
    }

    replacePrevious = (newText: string) => {
    }

    replaceAll = (newText: string) => {
    }
}


interface D3LinkNode extends d3.layout.force.Node {
    name: string
}
interface D3Link {
    source: D3LinkNode;
    target: D3LinkNode;
}

var prefixes = {
    circle: 'circle'
}

class RenderGraph{
    graph: d3.Selection<any>;
    links:d3.Selection<d3.layout.force.Link<d3.layout.force.Node>>;
    nodes:d3.Selection<d3.layout.force.Node>;
    text:d3.Selection<d3.layout.force.Node>;

    constructor(public config:{
        dependencies: FileDependency[],
        graphRoot: JQuery,
        controlRoot: JQuery,
        display: (content: FileDependency) => any
    }){
        var d3Root = d3.select(config.graphRoot[0]);
        let self = this;

        var messagesElement = config.controlRoot.find('.general-messages');
        messagesElement.text("No Issues Found!")
        var filterElement = config.controlRoot.find('#filter');
        filterElement.keyup(()=>{
            let val = filterElement.val().trim();
            this.applyFilter(val);
        });
        let copyDisplay = config.controlRoot.find('.copy-message>button');

        // Compute the distinct nodes from the links.
        var d3NodeLookup: { [name: string]: D3LinkNode } = {};
        var d3links: D3Link[] = config.dependencies.map(function(link) {
            var source = d3NodeLookup[link.sourcePath] || (d3NodeLookup[link.sourcePath] = { name: link.sourcePath });
            var target = d3NodeLookup[link.targetPath] || (d3NodeLookup[link.targetPath] = { name: link.targetPath });
            return { source, target };
        });

        // Calculate all the good stuff
        var d3Graph = new D3Graph(d3links);

        // If any cycles found log them:
        if (d3Graph.cycles().length) {
            let cycles = d3Graph.cycles();
            let message = '';
            let textContent = '';
            for (let cycle of cycles) {
                message += '<h3>Cycle Found: </h3>';
                message += cycle.join(' <br/> ') + '<br/>';
                textContent += '---Cycle Found---' + EOL;
                textContent += cycle.join(EOL) + EOL;
            }
            messagesElement.html(message);

            copyDisplay.show().on('click', () => {
                // TODO: copy to clipboard
                // atom.clipboard.write(textContent);
                // atom.notifications.addInfo('Copied!');
            });
        } else {
            copyDisplay.hide();
            messagesElement.hide();
        }

        // setup weights based on degrees
        Object.keys(d3NodeLookup).forEach(name=> {
            var node = d3NodeLookup[name];
            node.weight = d3Graph.avgDeg(node);
        })

        // Setup zoom
        var zoom = d3.behavior.zoom();
        zoom.scale(0.4);
        zoom.on("zoom", onZoomChanged);

        this.graph = d3Root.append("svg")
            .style('flex', '1')
            .call(zoom)
            .append('svg:g');
        var layout = d3.layout.force()
            .nodes(d3.values(d3NodeLookup))
            .links(d3links)
            .gravity(.05)
            .linkDistance(function(link: D3Link) { return (d3Graph.difference(link)) * 200; })
            .charge(-900)
            .on("tick", this.tick)
            .start();

        var drag = layout.drag()
            .on("dragstart", dragstart);

        /** resize initially and setup for resize */
        resize();
        d3.select(window).on("resize", resize);
        centerGraph();

        var graphWidth, graphHeight;
        function resize() {
            graphWidth = config.graphRoot.width();
            graphHeight = config.graphRoot.height();
            self.graph.attr("width", graphWidth)
                .attr("height", graphHeight);
            layout.size([graphWidth, graphHeight])
                .resume();
        }

        function centerGraph() {
            var centerTranslate:[number,number] = [
                (graphWidth / 4),
                (graphHeight / 4),
            ];
            zoom.translate(centerTranslate);
            // Render transition
            self.graph.transition()
                .duration(500)
                .attr("transform", "translate(" + zoom.translate() + ")" + " scale(" + zoom.scale() + ")");
        }


        function onZoomChanged() {
            self.graph.attr("transform", "translate(" + (d3.event as any).translate + ")" + " scale(" + (d3.event as any).scale + ")");
        }


        // Per-type markers, as they don't inherit styles.
        self.graph.append("defs").selectAll("marker")
            .data(["regular"])
            .enter().append("marker")
            .attr("id", function(d) { return d; })
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 15)
            .attr("refY", -1.5)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5");

        this.links = self.graph.append("g").selectAll("path")
            .data(layout.links())
            .enter().append("path")
            .attr("class", function(d: D3Link) { return "link"; })
            .attr("data-target", function(o: D3Link) { return self.htmlName(o.target) })
            .attr("data-source", function(o: D3Link) { return self.htmlName(o.source) })
            .attr("marker-end", function(d: D3Link) { return "url(#regular)"; });

        this.nodes = self.graph.append("g").selectAll("circle")
            .data(layout.nodes())
            .enter().append("circle")
            .attr("class", function(d: D3LinkNode) { return formatClassName(prefixes.circle, d) }) // Store class name for easier later lookup
            .attr("data-name", function(o: D3LinkNode) { return self.htmlName(o) }) // Store for easier later lookup
            .attr("r", function(d: D3LinkNode) { return Math.max(d.weight, 3); })
            .classed("inonly", function(d: D3LinkNode) { return d3Graph.inOnly(d); })
            .classed("outonly", function(d: D3LinkNode) { return d3Graph.outOnly(d); })
            .classed("circular", function(d: D3LinkNode) { return d3Graph.isCircular(d); })
            .call(drag)
            .on("dblclick", dblclick) // Unstick
            .on("mouseover", function(d: D3LinkNode) { onNodeMouseOver(d) })
            .on("mouseout", function(d: D3LinkNode) { onNodeMouseOut(d) })

        this.text = self.graph.append("g").selectAll("text")
            .data(layout.nodes())
            .enter().append("text")
            .attr("x", 8)
            .attr("y", ".31em")
            .attr("data-name", function(o: D3LinkNode) { return self.htmlName(o) })
            .text(function(d: D3LinkNode) { return d.name; });


        function onNodeMouseOver(d: D3LinkNode) {

            // Highlight circle
            var elm = findElementByNode(prefixes.circle, d);
            elm.classed("hovering", true);

            updateNodeTransparencies(d, true);
        }
        function onNodeMouseOut(d: D3LinkNode) {
            // Highlight circle
            var elm = findElementByNode(prefixes.circle, d);
            elm.classed("hovering", false);

            updateNodeTransparencies(d, false);
        }

        let findElementByNode = (prefix, node) => {
            var selector = '.' + formatClassName(prefix, node);
            return self.graph.select(selector);
        }

        function updateNodeTransparencies(d: D3LinkNode, fade = true) {

            // clean
            this.nodes.classed('not-hovering', false);
            this.nodes.classed('dimmed', false);

            if (fade) {
                this.nodes.each(function(o: D3LinkNode) {
                    if (!d3Graph.isConnected(d, o)) {
                        this.classList.add('not-hovering');
                        this.classList.add('dimmed');
                    }
                });
            }

            // Clean
            self.graph.selectAll('path.link').attr('data-show', '')
                .classed('outgoing', false)
                .attr('marker-end', fade ? '' : 'url(#regular)')
                .classed('incomming', false)
                .classed('dimmed', fade);

            this.links.each(function(o: D3Link) {
                if (o.source.name === d.name) {
                    this.classList.remove('dimmed');

                    // Highlight target of the link
                    var elmNodes = self.graph.selectAll('.' + formatClassName(prefixes.circle, o.target));
                    elmNodes.attr('fill-opacity', 1);
                    elmNodes.attr('stroke-opacity', 1);
                    elmNodes.classed('dimmed', false);

                    // Highlight arrows
                    let outgoingLink = self.graph.selectAll('path.link[data-source="' + self.htmlName(o.source) + '"]');
                    outgoingLink.attr('data-show', 'true');
                    outgoingLink.attr('marker-end', 'url(#regular)');
                    outgoingLink.classed('outgoing', true);

                }
                else if (o.target.name === d.name) {
                    this.classList.remove('dimmed');

                    // Highlight arrows
                    let incommingLink = self.graph.selectAll('path.link[data-target="' + self.htmlName(o.target) + '"]');
                    incommingLink.attr('data-show', 'true');
                    incommingLink.attr('marker-end', 'url(#regular)');
                    incommingLink.classed('incomming', true);

                }
            });

            this.text.classed("dimmed", function(o: D3LinkNode) {
                if (!fade) return false;

                if (d3Graph.isConnected(d, o)) return false;

                return true;
            });

        }

        // Helpers
        function formatClassName(prefix, object: D3LinkNode) {
            return prefix + '-' + self.htmlName(object);
        }

        function dragstart(d) {
            d.fixed = true; // http://bl.ocks.org/mbostock/3750558
            (d3.event as any).sourceEvent.stopPropagation(); // http://bl.ocks.org/mbostock/6123708
            d3.select(this).classed("fixed", true);
        }

        function dblclick(d) {
            d3.select(this).classed("fixed", d.fixed = false);
        }
    }

    // Use elliptical arc path segments to doubly-encode directionality.
    tick = () => {
        function transform(d: D3LinkNode) {
            return "translate(" + d.x + "," + d.y + ")";
        }
        this.links.attr("d", linkArc);
        this.nodes.attr("transform", transform);
        this.text.attr("transform", transform);
    }

    applyFilter = utils.debounce((val: string) => {
        if (!val) {
            this.nodes.classed('filtered-out', false);
            this.links.classed('filtered-out', false);
            this.text.classed('filtered-out', false);
            return;
        }
        else {
            this.nodes.classed('filtered-out', true);
            this.links.classed('filtered-out', true);
            this.text.classed('filtered-out', true);
            let filteredNodes = this.graph.selectAll(`circle[data-name*="${this.htmlName({ name: val }) }"]`);
            filteredNodes.classed('filtered-out', false);
            var filteredLinks = this.graph.selectAll(`[data-source*="${this.htmlName({ name: val }) }"][data-target*="${this.htmlName({ name: val }) }"]`);
            filteredLinks.classed('filtered-out', false);
            let filteredText = this.graph.selectAll(`text[data-name*="${this.htmlName({ name: val }) }"]`);
            filteredText.classed('filtered-out', false);
        }
    },250);

    /**
     * Helpers
     */
    private htmlName(object: D3LinkNode) {
        return object.name.replace(/(\.|\/)/gi, '-');
    }
}

interface TargetBySourceName
{ [source: string]: D3LinkNode[] }

/**
 * Degree : The number of connections
 * Bit of a lie about degrees : 0 is changed to 1 intentionally
 */
class D3Graph {
    private inDegLookup = {};
    private outDegLookup = {};
    private linkedByName = {};
    private targetsBySourceName: TargetBySourceName = {};
    private circularPaths: string[][] = [];
    constructor(private links: D3Link[]) {
        links.forEach(l=> {
            if (!this.inDegLookup[l.target.name]) this.inDegLookup[l.target.name] = 2;
            else this.inDegLookup[l.target.name]++;

            if (!this.outDegLookup[l.source.name]) this.outDegLookup[l.source.name] = 2;
            else this.outDegLookup[l.source.name]++;

            // Build linked lookup for quick connection checks
            this.linkedByName[l.source.name + "," + l.target.name] = 1;

            // Build an adjacency list
            if (!this.targetsBySourceName[l.source.name]) this.targetsBySourceName[l.source.name] = [];
            this.targetsBySourceName[l.source.name].push(l.target);
        });

        // Taken from madge
        this.findCircular();
    }
    public inDeg(node: D3LinkNode) {
        return this.inDegLookup[node.name] ? this.inDegLookup[node.name] : 1;
    }
    public outDeg(node: D3LinkNode) {
        return this.outDegLookup[node.name] ? this.outDegLookup[node.name] : 1;
    }
    public avgDeg(node: D3LinkNode) {
        return (this.inDeg(node) + this.outDeg(node)) / 2;
    }
    public isConnected(a: D3LinkNode, b: D3LinkNode) {
        return this.linkedByName[a.name + "," + b.name] || this.linkedByName[b.name + "," + a.name] || a.name == b.name;
    }
    /** how different are the two nodes in the link */
    public difference(link: D3Link) {
        // take file path into account:
        return 5; // TODO: relative(link.source.name, link.target.name).split('/').length;
    }
    public inOnly(node: D3LinkNode) {
        return !this.outDegLookup[node.name] && this.inDegLookup[node.name];
    }
    public outOnly(node: D3LinkNode) {
        return !this.inDegLookup[node.name] && this.outDegLookup[node.name];
    }

    /**
    * Get path to the circular dependency.
    */
    private getPath(parent: D3LinkNode, unresolved: { [source: string]: boolean }): string[] {
        var parentVisited = false;

        return Object.keys(unresolved).filter((module) => {
            if (module === parent.name) {
                parentVisited = true;
            }
            return parentVisited && unresolved[module];
        });
    }

    /**
     * A circular dependency is occurring when we see a software package
     * more than once, unless that software package has all its dependencies resolved.
     */
    private resolver(sourceName: string, resolved: { [source: string]: boolean }, unresolved: { [source: string]: boolean }) {
        unresolved[sourceName] = true;

        if (this.targetsBySourceName[sourceName]) {
            this.targetsBySourceName[sourceName].forEach((dependency) => {
                if (!resolved[dependency.name]) {
                    if (unresolved[dependency.name]) {
                        this.circularPaths.push(this.getPath(dependency, unresolved));
                        return;
                    }
                    this.resolver(dependency.name, resolved, unresolved);
                }
            });
        }

        resolved[sourceName] = true;
        unresolved[sourceName] = false;
    }

    /**
     * Finds all circular dependencies for the given modules.
     */
    private findCircular() {
        var resolved: any = {},
            unresolved: any = {};

        Object.keys(this.targetsBySourceName).forEach((sourceName) => {
            this.resolver(sourceName, resolved, unresolved);
        });
    };

    /** Check if the given module is part of a circular dependency */
    public isCircular(node: D3LinkNode) {
        var cyclic = false;
        this.circularPaths.some((path) => {
            if (path.indexOf(node.name) >= 0) {
                cyclic = true;
                return true;
            }
            return false;
        });
        return cyclic;
    }

    public cycles(): string[][] {
        return this.circularPaths;
    }
}


/** modified version of http://stackoverflow.com/a/26616564/390330 Takes weight into account */
function linkArc(d: D3Link) {
    var targetX = d.target.x;
    var targetY = d.target.y;

    var sourceX = d.source.x;
    var sourceY = d.source.y;

    var theta = Math.atan((targetX - sourceX) / (targetY - sourceY));
    var phi = Math.atan((targetY - sourceY) / (targetX - sourceX));

    var sinTheta = d.source.weight / 2 * Math.sin(theta);
    var cosTheta = d.source.weight / 2 * Math.cos(theta);
    var sinPhi = (d.target.weight - 6) * Math.sin(phi);
    var cosPhi = (d.target.weight - 6) * Math.cos(phi);

    // Set the position of the link's end point at the source node
    // such that it is on the edge closest to the target node
    if (d.target.y > d.source.y) {
        sourceX = sourceX + sinTheta;
        sourceY = sourceY + cosTheta;
    }
    else {
        sourceX = sourceX - sinTheta;
        sourceY = sourceY - cosTheta;
    }

    // Set the position of the link's end point at the target node
    // such that it is on the edge closest to the source node
    if (d.source.x > d.target.x) {
        targetX = targetX + cosPhi;
        targetY = targetY + sinPhi;
    }
    else {
        targetX = targetX - cosPhi;
        targetY = targetY - sinPhi;
    }

    // Draw an arc between the two calculated points
    var dx = targetX - sourceX,
        dy = targetY - sourceY,
        dr = Math.sqrt(dx * dx + dy * dy);
    return "M" + sourceX + "," + sourceY + "A" + dr + "," + dr + " 0 0,1 " + targetX + "," + targetY;

}