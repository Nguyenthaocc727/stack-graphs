// -*- coding: utf-8 -*-
// ------------------------------------------------------------------------------------------------
// Copyright © 2022, stack-graphs authors.
// Licensed under either of Apache License, Version 2.0, or MIT license, at your option.
// Please see the LICENSE-APACHE or LICENSE-MIT files in this distribution for license details.
// ------------------------------------------------------------------------------------------------

'use strict';

class StackGraph {

    static margin = 6;
    static distx = 15;
    static disty = 15;

    constructor(container, graph, paths) {
        this.graph = graph;
        this.paths = paths;
        this.compute_data();
        this.current_node = null;
        this.current_edge = null;
        this.paths_lock = null;
        this.render();
    }

    compute_data() {
        this.ID = {};
        this.N = [];
        for (let i in graph.nodes) {
            const node = graph.nodes[i];
            node.paths = []
            this.ID[this.node_to_id_str(node)] = i;
            this.N.push(node);
        }
        const jumps = {};
        for (let path of this.paths) {
            const nodes = path.edges.map((e) => e.source);
            nodes.push(path.end_node);
            const node_ids = [this.node_id_to_str(nodes[0])];
            const edge_ids = [];
            for (let i = 1; i < nodes.length; i++) {
                const source = nodes[i - 1];
                const sink = nodes[i];
                const edge = this.edge_to_id_str({ source, sink });
                edge_ids.push(edge);
                node_ids.push(this.node_id_to_str(sink));
                if (this.N[this.ID[this.node_id_to_str(source)]].type === 'jump_to_scope' && jumps[edge] !== true) {
                    jumps[edge] = true;
                    this.graph.edges.push({
                        precedence: 0,
                        source,
                        sink,
                        is_jump: true,
                    });
                }
            }
            const symbol_stack = path.symbol_stack.map((s) => s.symbol /* FIXME scopes */);
            const scope_stack = path.scope_stack.map((n) => this.node_id_to_str(n));
            this.N[this.ID[this.node_id_to_str(path.start_node)]].paths.push({
                node_ids, edge_ids, symbol_stack, scope_stack
            });
        }
    }

    render() {
        let that = this;

        // define svg
        const svg = container.append('svg')
            .attr('width', '100%')
            .attr('height', '100%');

        // pan & zoom
        let zoom = d3.zoom()
            .on('start', (e) => {
                background.classed("engaged", true);
            }).on('zoom', (e) => {
                sg.attr('transform', e.transform);
            }).on('end', (e) => {
                background.classed("engaged", false);
            });
        const background = svg.append("rect")
            .attr("class", "sg-background");
        background.call(zoom);

        const sg = svg.append('g').attr('class', 'sg');
        const edge_group = sg.append("g");
        const node_group = sg.append("g");

        const connect = d3.dagConnect()
            .sourceId((edge) => this.ID[this.node_id_to_str(edge.source)])
            .targetId((edge) => this.ID[this.node_id_to_str(edge.sink)])
            .decycle(true);
        const dag = connect(this.graph.edges);
        // restore reversed edges
        for (let link of dag.links()) {
            if (link.reversed) {
                console.log(link);
                delete link.reversed;
                link.points.reverse();
            }
        }

        // plot nodes
        const nodes = node_group
            .selectAll("g")
            .data(dag.descendants())
            .enter()
            .append("g");
        nodes.each(function (d, idx, gs) {
            that.render_node(that.N[d.data.id], d3.select(this));
        });
        nodes.each(function (d, idx, gs) {
            const bbox = this.getBBox({ fill: true, stroke: true });
            d.width = bbox.width;
            d.height = bbox.height;
        });

        const layout = d3.sugiyama()
            .nodeSize((d) => {
                return d === undefined ? [0, 0] : [d.width + 2 * StackGraph.distx, d.height + 2 * StackGraph.disty];
            });
        const { width, height } = layout(dag);

        // set viewport
        sg.attr("viewBox", [0, 0, width, height].join(" "));

        // plot edges
        const line = d3.line()
            .curve(d3.curveCatmullRom)
            .x((d) => d.x)
            .y((d) => d.y);
        const edges = edge_group
            .selectAll("path")
            .data(dag.links())
            .enter()
            .append("g")
            .attr("class", (d) => d.data.is_jump ? "jump" : "edge")
            .attr("id", (d) => this.edge_to_id_str(d.data));
        edges.append("path")
            .attr("id", (d) => this.edge_to_id_str(d.data) + ":path")
            .attr("d", ({ points }) => line(points))
        let edge_labels = edges.append("text")
            .append("textPath")
            .attr("xlink:href", (d) => `#${this.edge_to_id_str(d.data)}:path`)
            .attr("startOffset", "45%")
            .text("➤");

        // position nodes
        nodes
            .attr("transform", ({ x, y, width, height }) => `translate(${x + StackGraph.margin - width / 2}, ${y - StackGraph.margin + height / 2})`);

        // tooltip
        d3.select('body').append('div')
            .attr('id', 'sg-tooltip');

        // mouse events
        nodes
            .on("mouseover", (e, d) => {
                const node = this.N[d.data.id];
                this.current_node = node;
                this.node_focus(node);
                this.paths_mouseover(e, node);
                this.tooltip_mouseover(e);
            })
            .on("mousemove", (e, d) => {
                const node = this.N[d.data.id];
                this.tooltip_mousemove(e);
            })
            .on("mouseout", (e, d) => {
                const node = this.N[d.data.id];
                this.current_node = null;
                this.tooltip_mouseout(e);
                this.paths_mouseout(e, node);
                this.node_defocus(node);
            })
            .on("click", (e, d) => {
                const node = this.N[d.data.id];
                this.paths_click(e, node);
            });

        edge_labels
            .on("mouseover", (e, d) => {
                let edge = d.data;
                this.current_edge = edge;
                this.tooltip_mouseover(e);
            })
            .on("mousemove", (e, d) => {
                let edge = d.data;
                this.tooltip_mousemove(e);
            })
            .on("mouseout", (e, d) => {
                let edge = d.data;
                this.current_edge = null;
                this.tooltip_mouseout(e);
            });

        // key events
        d3.select(window).on("keyup", (e) => {
            this.paths_keypress(e);
        })
    }

    // ------------------------------------------------------------------------------------------------
    // Node Rendering
    //

    render_node(node, g) {
        g.attr('id', this.node_to_id_str(node));
        g.attr('class', `node ${node.type}`);

        switch (node.type) {
            case "drop_scopes":
                this.render_scope(g);
                break;
            case "jump_to_scope":
                this.render_scope(g);
                break;
            case "pop_symbol":
                this.render_symbol_node(g, "↑" + node.symbol);
                if (node.is_definition) {
                    g.classed('definition', true);
                }
                break;
            case "pop_scoped_symbol":
                let pop_scope = { class: "pop_scope" };
                this.render_symbol_node(g, "↑" + node.symbol, pop_scope);
                if (node.is_definition) {
                    g.classed('definition', true);
                }
                break;
            case "push_symbol":
                this.render_symbol_node(g, "↓" + node.symbol);
                if (node.is_reference) {
                    g.classed('reference', true);
                }
                break;
            case "push_scoped_symbol":
                let push_scope = { class: "push_scope" };
                this.render_symbol_node(g, "↓" + node.symbol, push_scope);
                if (node.is_reference) {
                    g.classed('reference', true);
                }
                break;
            case "root":
                this.render_scope(g);
                break;
            case "scope":
                this.render_scope(g);
                if (node.is_exported) {
                    g.classed('exported', true);
                }
                break;
        }
    }

    render_symbol_node(g, text, scope) {
        let content = g.append("g");
        content.append('text').text(text);
        let text_bbox = content.node().getBBox();
        if (scope !== undefined) {
            content.append("circle")
                .attr("class", scope.class)
                .attr("transform", `translate(${text_bbox.width + StackGraph.margin}, ${6 - text_bbox.height / 2})`);
            content.append("circle")
                .attr("class", scope.class + "-focus-point")
                .attr("transform", `translate(${text_bbox.width + StackGraph.margin}, ${6 - text_bbox.height / 2})`);
        }
        let bbox = content.node().getBBox();
        g.append('rect').lower()
            .attr("class", "background")
            .attr('x', bbox.x - StackGraph.margin)
            .attr('y', bbox.y - StackGraph.margin)
            .attr('width', bbox.width + 2 * StackGraph.margin)
            .attr('height', bbox.height + 2 * StackGraph.margin);
        g.append('rect').lower().lower()
            .attr("class", "border")
            .attr('x', bbox.x - StackGraph.margin)
            .attr('y', bbox.y - StackGraph.margin)
            .attr('width', bbox.width + 2 * StackGraph.margin)
            .attr('height', bbox.height + 2 * StackGraph.margin);
    }

    render_scope(g) {
        g.append('circle')
            .attr("class", "border");
        g.append('circle')
            .attr("class", "background");
        g.append('circle')
            .attr("class", "focus-point");
    }

    // ------------------------------------------------------------------------------------------------
    // Node Highlighting
    //

    node_focus(node) {
        d3.select(this.id_selector(this.node_id_to_str(node.id)))
            .classed("focus", true);
        if (node.hasOwnProperty("scope")) {
            d3.select(this.id_selector(this.node_id_to_str(node.scope)))
                .classed("ref-focus", true);
        }
    }

    node_defocus(node) {
        d3.select(this.id_selector(this.node_id_to_str(node.id)))
            .classed("focus", false);
        if (node.hasOwnProperty("scope")) {
            d3.select(this.id_selector(this.node_id_to_str(node.scope)))
                .classed("ref-focus", false);
        }
    }

    /* ------------------------------------------------------------------------------------------------
    * Path Highlighting
    */

    paths_mouseover(e, node) {
        if (this.paths_lock !== null) {
            return;
        }
        this.paths_highlight(node);
    }

    paths_mouseout(e, node) {
        if (this.paths_lock !== null) {
            return;
        }
        this.paths_nolight(node);
    }

    paths_click(e, node) {
        if (this.paths_lock === null) {
            if (node.paths.length > 0) {
                this.paths_nolight(node);
                this.paths_lock = { node, path: 0 };
                this.paths_highlight(node, 0);
                this.tooltip_update();
            }
        } else if (this.paths_lock.node === node) {
            this.paths_nolight(node, this.paths_lock.path);
            this.paths_lock.path += 1;
            if (this.paths_lock.path >= node.paths.length) {
                this.paths_lock = null;
                this.paths_highlight(node);
            } else {
                this.paths_highlight(node, this.paths_lock.path);
            }
            this.tooltip_update();
        }
    }

    paths_keypress(e) {
        if (this.paths_lock !== null) {
            if (e.keyCode === 27) {
                this.paths_nolight(this.paths_lock.node);
                this.node_defocus(this.paths_lock.node);
                this.paths_lock = null;
                if (this.current_node !== null) {
                    this.node_focus(this.current_node);
                    this.paths_highlight(this.current_node);
                    this.tooltip_update();
                }
            } else if (e.keyCode == 78) {
                this.paths_nolight(this.paths_lock.node, this.paths_lock.path);
                this.paths_lock.path += 1;
                if (this.paths_lock.path >= this.paths_lock.node.paths.length) {
                    this.paths_lock.path = 0;
                }
                this.paths_highlight(this.paths_lock.node, this.paths_lock.path);
                if (this.current_node !== null) {
                    this.tooltip_update();
                }
            }
        }
    }

    paths_highlight(node, path) {
        const paths = (path !== undefined) ? [node.paths[path]] : node.paths;
        const nodes = {};
        const edges = {};
        for (let path of paths) {
            for (let node_id of path.node_ids) {
                if (!nodes.hasOwnProperty(node_id)) {
                    nodes[node_id] = false;
                }
            }
            if (path.node_ids.length > 0) {
                nodes[path.node_ids[0]] = true;
                nodes[path.node_ids[path.node_ids.length - 1]] = true;
            }
            for (let edge_id of path.edge_ids) {
                if (!edges.hasOwnProperty(edge_id)) {
                    edges[edge_id] = 0;
                }
                edges[edge_id] += 1;
            }
            for (let node in nodes) {
                const g = d3.select(this.id_selector(node));
                g.classed("path-node", true);
                if (nodes[node]) {
                    g.classed("path-endpoint", true);
                }
            }
            for (let edge in edges) {
                const g = d3.select(this.id_selector(edge));
                g.classed("path-edge", true);
            }
        }
    }

    paths_nolight(node, path) {
        const paths = (path !== undefined) ? [node.paths[path]] : node.paths;
        for (let path of paths) {
            for (let node_id of path.node_ids) {
                const g = d3.select(this.id_selector(node_id));
                g.classed("path-node", false);
                g.classed("path-endpoint", false);
            }
            for (let edge_id of path.edge_ids) {
                const g = d3.select(this.id_selector(edge_id));
                g.classed("path-edge", false);
            }
        }
    }

    // ------------------------------------------------------------------------------------------------
    // Tooltip
    //

    tooltip_mousemove(e, node) {
        d3.select('#sg-tooltip')
            .style('left', e.pageX + 4 + 'px')
            .style('top', e.pageY + 4 + 'px');
    }

    tooltip_mouseover(e) {
        this.tooltip_update();
    }

    tooltip_mouseout(e) {
        this.tooltip_update();
    }

    tooltip_update() {
        const tooltip = d3.select('#sg-tooltip');
        // clear
        tooltip.selectAll("*").remove();
        // create table
        const tbody = tooltip.append("table")
            .attr("class", "sg-tooltip-table")
            .append("tbody");
        function add_header(label) {
            const tr = tbody.append("tr")
                .attr("class", "sg-tooltip-header");
            tr.append("td")
                .attr("colspan", "2")
                .text(label);
        }
        function add_row(label, value) {
            const tr = tbody.append("tr");
            tr.append("td").attr("class", "sg-tooltip-label").text(label);
            tr.append("td").attr("class", "sg-tooltip-value").text(value);
        }
        let tooltip_methods = {
            add_header,
            add_row,
        };

        if (this.current_node != null) {
            this.tooltip_node_update(tooltip_methods, this.current_node);
            if (this.paths_lock !== null) {
                this.tooltip_path_update(tooltip_methods, this.paths_lock);
            }
            tooltip.style('visibility', 'visible');
        } else if (this.current_edge != null) {
            this.tooltip_edge_update(tooltip_methods, this.current_edge);
            if (this.paths_lock !== null) {
                this.tooltip_path_update(tooltip_methods, this.paths_lock);
            }
            tooltip.style('visibility', 'visible');
        } else {
            tooltip.style('visibility', 'hidden');
        }
    }

    tooltip_edge_update(tooltip, edge) {
        tooltip.add_header("edge info");
        tooltip.add_row("source", this.node_id_to_str(edge.source));
        tooltip.add_row("sink", this.node_id_to_str(edge.sink));
        if (edge.hasOwnProperty("precedence")) {
            tooltip.add_row("precedence", edge.precedence);
        }

        if (edge.hasOwnProperty("debug_info") && edge.debug_info.length > 0) {
            tooltip.add_header("debug info");
            for (let { key, value } of edge.debug_info) {
                tooltip.add_row(key, value);
            }
        }
    }

    tooltip_node_update(tooltip, node) {
        tooltip.add_header("node info");
        tooltip.add_row("id", this.node_to_id_str(node));
        tooltip.add_row("type", node.type);
        if (node.hasOwnProperty("scope")) {
            tooltip.add_row("scope", this.node_id_to_str(node.scope));
        }
        if (node.hasOwnProperty("is_reference")) {
            tooltip.add_row("reference?", node.is_reference ? "yes" : "no");
        }
        if (node.hasOwnProperty("is_definition")) {
            tooltip.add_row("definition?", node.is_definition ? "yes" : "no");
        }
        if (node.hasOwnProperty("is_exported")) {
            tooltip.add_row("exported?", node.is_exported ? "yes" : "no");
        }
        if (this.node_has_source_info(node)) {
            tooltip.add_row("location", this.source_info_to_str(node.source_info));
        }
        if (node.paths.length > 0) {
            tooltip.add_row("outgoing paths", node.paths.length);
        }

        if (node.hasOwnProperty("debug_info") && node.debug_info.length > 0) {
            tooltip.add_header("debug info");
            for (let { key, value } of node.debug_info) {
                tooltip.add_row(key, value);
            }
        }
    }

    tooltip_path_update(tooltip, paths_lock) {
        tooltip.add_header("path info (next: N, exit: Esc)");
        if (paths_lock.node === this.current_node) {
            tooltip.add_row("current", `path ${paths_lock.path + 1} of ${this.current_node.paths.length} (click to cycle)`);
        } else {
            tooltip.add_row("current", `path ${paths_lock.path + 1} of ${paths_lock.node.paths.length} of ${this.node_to_id_str(paths_lock.node)}`);
        }
        let path = paths_lock.node.paths[paths_lock.path];
        tooltip.add_row("final symbol stack", path.symbol_stack.join(""));
        tooltip.add_row("final scope stack", path.scope_stack.join(" "));
    }



    // ------------------------------------------------------------------------------------------------
    // Node & Edge IDs
    //

    node_to_id_str(node) {
        return this.node_id_to_str(node.id);
    }

    edge_to_id_str(edge) {
        return this.node_id_to_str(edge.source) + "->" + this.node_id_to_str(edge.sink);
    }

    node_id_to_str(id) {
        if (id.hasOwnProperty('file')) {
            return id.file + "#" + id.local_id;
        } else {
            return "#" + id.local_id;
        }
    }

    id_selector(id) {
        const sel = "#" + id.replaceAll(/[^a-zA-Z0-9]/g, '\\$&');
        return sel;
    }

    // ------------------------------------------------------------------------------------------------
    // Source Info
    //

    node_has_source_info(node) {
        return node.hasOwnProperty("source_info")
            && !this.source_info_is_empty(node.source_info);
    }

    source_info_to_str(source_info) {
        const line = source_info.span.start.line;
        const column = source_info.span.start.column.grapheme_offset;
        return `line ${line + 1} column ${column + 1}`;
    }

    source_info_is_empty(source_info) {
        return source_info.span.start.line === 0
            && source_info.span.start.column.utf8_offset === 0
            && source_info.span.end.line === 0
            && source_info.span.end.column.utf8_offset === 0;
    }

}