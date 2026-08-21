---
name: satyam-hackathon-winning
description: Use when prioritizing, scoping, designing, reviewing, demonstrating, or preparing submission work for the ModelContract hackathon project.
---

# Satyam / Winning Hackathon & Judging Lens

## Core Principle

Build to win the judging process, not to maximize feature count.

Every task must improve either:

1. the judge-facing demo
2. the technical proof behind that demo

Otherwise question whether it belongs.

## Required Questions

For every meaningful decision ask:

1. Can a judge understand the value in under 20 seconds?
2. Is Bright Data visibly central to the story?
3. Is there one memorable moment?
4. Does this improve a judging criterion?
5. Does it make the demo more reliable?
6. Does it reduce explanation complexity?
7. Are we building something judges will actually see or ask about?
8. Are we adding scope because it is necessary or because it is interesting?
9. Is there a simpler path with the same judging impact?
10. Will this work reliably during recording/live judging?

## Winning Demo

The central ModelContract contrast is:

**BROKEN EXTRACTION**
-> detect -> retry -> quarantine -> Bright Data repair -> verify -> recover

versus

**REAL SEMANTIC CHANGE**
-> detect -> persist -> DO NOT HEAL REALITY

Memorable sentence:

> "The scraper broke, so ModelContract repaired the extraction.
> The price changed, so ModelContract refused to repair reality."

## Scope Discipline

Prefer:

- one provider
- one controlled mutation harness
- one real Bright Data collector
- one polished extraction-recovery path
- one semantic-change contrast
- one compatibility proof
- three simple judge-facing views

Avoid before release candidate:

- extra providers
- generic frameworks
- analytics
- auth
- billing
- RAG
- chatbots
- Kafka
- Kubernetes
- queues
- microservices
- large policy engines
- elaborate landing pages

## Sponsor Rule

Bright Data must be unmistakable.

The demo should expose real evidence such as:

- collector ID
- run ID
- failed extraction
- repair interaction
- recovered extraction

ModelContract must visibly add value after Bright Data:

- classification
- quarantine
- semantic verification
- approve/reject
- contract safety

## Demo Reliability Rule

Do not choose a technically clever flow that adds hidden manual setup,
multiple collector swaps, fragile resets, or long explanations if a simpler
credible flow exists.

A judge should see cause -> effect immediately.

## Deadline Rule

Near the deadline, optimize in this order:

1. mandatory correctness
2. demo reliability
3. sponsor visibility
4. technical proof
5. submission quality
6. visual polish
7. optional features

Do not sacrifice a working end-to-end story for broader scope.

## Decision Bias

When choosing between:

- "more features"

and

- "a clearer, more defensible winning story"

choose the clearer winning story.
