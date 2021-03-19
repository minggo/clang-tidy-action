/* eslint-disable object-shorthand */
/**
 * Disable ESLint camel case check and the
 * GitHub API doesn't use it.
 * See https://developer.github.com/v3/checks/runs/#annotations-object-1
 */
/* eslint-disable @typescript-eslint/camelcase */

import * as core from "@actions/core";
import CONSTANTS from "./constants";
import {Diagnostic} from "./diagnostics";

const {CHECK_NAME, OCTOKIT, OWNER, REPO, SHA} = CONSTANTS;

export async function report_annotations(result: {success: boolean; diags: Diagnostic[]}): Promise<void> {
	const conclusion = result.success ? "success" : "failure";
	const currentTimestamp = new Date().toISOString();

	/**
	 * Otherwise, if this IS a pull request
	 * create a GitHub check and add any
	 * annotations in batches to the check,
	 * then close the check.
	 */
	core.debug("Fetching files changed in the pull request.");

	// Wrap API calls in try/catch in case there are issues
	try {
		/**
		 * Create a new GitHub check and leave it in-progress
		 * See https://OCTOKIT.github.io/rest.js/#octokit-routes-checks
		 */
		const {
			data: {id: checkId},
		} = await OCTOKIT.checks.create({
			owner: OWNER,
			repo: REPO,
			started_at: currentTimestamp,
			head_sha: SHA,
			status: "in_progress",
			name: CHECK_NAME,
		});

		/**
		 * Update the GitHub check with the
		 * annotations from the report analysis.
		 *
		 * If there are more than 50 annotations
		 * we need to make multiple API requests
		 * to avoid rate limiting errors
		 *
		 * See https://developer.github.com/v3/checks/runs/#output-object-1
		 */
		const annotations = result.diags.map(ann => {
			return {
				path: ann.filePath,
				start_line: ann.location.line,
				end_line: ann.location.line,
				start_column: ann.location.column,
				end_column: ann.location.column + 1,
				annotation_level: ann.level,
				title: ann.level,
				message: ann.message,
			};
		});
		const numberOfAnnotations = annotations.length;
		let batch = 0;
		const batchSize = 50;
		const numBatches = Math.ceil(numberOfAnnotations / batchSize);
		while (annotations.length > batchSize) {
			// Increment the current batch number
			batch++;
			const batchMessage = `Found ${numberOfAnnotations} ESLint errors and warnings, processing batch ${batch} of ${numBatches}...`;
			core.info(batchMessage);
			const annotationBatch = annotations.splice(0, batchSize);
			await OCTOKIT.checks.update({
				owner: OWNER,
				repo: REPO,
				check_run_id: checkId,
				status: "in_progress",
				output: {
					title: CHECK_NAME,
					summary: batchMessage,
					annotations: annotationBatch,
				},
			});
		}

		/**
		 * Finally, close the GitHub check as completed
		 * with any remaining annotations
		 */
		await OCTOKIT.checks.update({
			conclusion: conclusion,
			owner: OWNER,
			repo: REPO,
			completed_at: currentTimestamp,
			status: "completed",
			check_run_id: checkId,
			output: {
				title: CHECK_NAME,
				summary: ` clang tidy ${annotations.length} issues`,
				annotations: annotations,
			},
		});

		// Fail the action if lint analysis was not successful
		if (!result.success) {
			core.setFailed("ESLint errors detected.");
			process.exit(1);
		}
	} catch (err) {
		// Catch any errors from API calls and fail the action
		core.setFailed(
			err.message ? err.message : "Error annotating files in the pull request from the ESLint report.",
		);
		process.exit(1);
	}
}
